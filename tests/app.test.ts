import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_QUESTIONS } from "../src/data/test-questions";
import { checkAdminPassword } from "../src/lib/admin-auth";
import { EMBEDDING_DIMENSIONS, EmbeddingError, makeOpenAIEmbedder } from "../src/lib/embed";
import { ConfigError } from "../src/lib/env";
import { kindOf, recallHit, rlsHolds, saysNotFound, summarize, type EvalRow } from "../src/lib/eval";
import { IngestError, ingestPdf } from "../src/lib/ingest";
import { extractPages } from "../src/lib/ingestion/pdf";
import { NOT_FOUND_MESSAGE, SYSTEM_PROMPT, buildUserMessage, formatChunk } from "../src/lib/prompts";
import { retrieve, type MatchedChunk } from "../src/lib/retrieve";
import { bearerToken } from "../src/lib/supabase-server";

afterEach(() => vi.unstubAllEnvs());

const vec = (seed = 0) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === seed ? 1 : 0));

// ---------- embed ----------
describe("embed(OpenAI)", () => {
  const okFetch = (log: string[][] = []) =>
    (async (_url: string, init: { body: string }) => {
      const input = JSON.parse(init.body).input as string[];
      log.push(input);
      // わざと逆順で返して、index で並べ直せることを確かめる
      const data = input.map((_t, i) => ({ index: i, embedding: vec(i) })).reverse();
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as unknown as typeof fetch;

  it("64件ずつに分けて送り、順番どおりに返す", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const log: string[][] = [];
    const out = await makeOpenAIEmbedder(okFetch(log))(Array.from({ length: 130 }, (_, i) => `t${i}`));
    expect(log.map((b) => b.length)).toEqual([64, 64, 2]);
    expect(out).toHaveLength(130);
    expect(out[0][0]).toBe(1);
    expect(out[3][3]).toBe(1);
  });

  it("キーが無いときは、設定の漏れとして分かるメッセージを出す", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(makeOpenAIEmbedder(okFetch())(["a"])).rejects.toThrow(ConfigError);
  });

  it("401 は「キーが違う」、429 は「残高不足」と、分かる言葉にする", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const f = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
    await expect(makeOpenAIEmbedder(f(401))(["a"])).rejects.toThrow(/APIキーが正しくありません/);
    await expect(makeOpenAIEmbedder(f(429))(["a"])).rejects.toThrow(/残高/);
    await expect(makeOpenAIEmbedder(f(500))(["a"])).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("次元数が違う結果は、受け取らない", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const bad = (async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(makeOpenAIEmbedder(bad)(["a"])).rejects.toThrow(/次元数/);
  });
});

// ---------- prompts ----------
const chunk = (over: Partial<MatchedChunk> = {}): MatchedChunk => ({
  id: "c1", document_id: "d1", filename: "case7-doc1-strategy-dx-bank.pdf", title: "銀行A", department: "戦略",
  section_title: "4. ROI 試算", content: "本文", page_start: 1, page_end: 1, similarity: 0.9, ...over,
});

describe("prompts", () => {
  it("資料に、ファイル名とページと章の名前が付く", () => {
    expect(formatChunk(chunk(), 0)).toBe("[資料1] case7-doc1-strategy-dx-bank.pdf p.1-1(4. ROI 試算)\n本文");
    expect(formatChunk(chunk({ page_start: 2, page_end: 4 }), 1)).toContain("p.2-4");
  });
  it("資料が無いときも、質問は渡る", () => {
    expect(buildUserMessage("Q?", [])).toContain("(参考資料はありません)");
    expect(buildUserMessage("Q?", [chunk()])).toContain("質問: Q?");
  });
  it("システムプロンプトに、出典と「該当なし」のルールが入っている", () => {
    expect(SYSTEM_PROMPT).toContain("出典:");
    expect(SYSTEM_PROMPT).toContain(NOT_FOUND_MESSAGE);
  });
});

// ---------- retrieve ----------
describe("retrieve", () => {
  it("kb_match_chunks を、ベクトルと件数つきで呼ぶ", async () => {
    const rpc = vi.fn(async () => ({ data: [chunk()], error: null }));
    const out = await retrieve({ rpc } as never, vec(2), 5);
    expect(rpc).toHaveBeenCalledWith("kb_match_chunks", { query_embedding: JSON.stringify(vec(2)), match_count: 5 });
    expect(out).toHaveLength(1);
  });
  it("エラーは、日本語のメッセージで投げる", async () => {
    const rpc = async () => ({ data: null, error: { message: "boom" } });
    await expect(retrieve({ rpc } as never, vec())).rejects.toThrow(/検索でエラー/);
  });
});

// ---------- eval ----------
describe("eval", () => {
  it("12問の種類が、正しく分かれる(検索8・複数文書1・該当なし2・部署の制限1)", () => {
    const kinds = TEST_QUESTIONS.map(kindOf);
    expect(TEST_QUESTIONS).toHaveLength(12);
    expect(kinds.filter((k) => k === "single")).toHaveLength(8);
    expect(kinds.filter((k) => k === "multi")).toHaveLength(1);
    expect(kinds.filter((k) => k === "none")).toHaveLength(2);
    expect(kinds.filter((k) => k === "rls")).toHaveLength(1);
  });

  it("recallHit: 上位に正解の文書があれば当たり", () => {
    const top = [{ filename: "case7-doc2-hr-engagement-report.pdf" }, { filename: "case7-doc1-strategy-dx-bank.pdf" }];
    expect(recallHit("case7-doc1-strategy-dx-bank", top).hit).toBe(true);
    expect(recallHit("case7-doc3-it-cloud-migration", top)).toMatchObject({ hit: false, missing: ["case7-doc3-it-cloud-migration"] });
  });

  it("recallHit: 複数文書の質問は、全部そろって初めて当たり", () => {
    const exp = "case7-doc1 / case7-doc3 / case7-doc4";
    const two = [{ filename: "case7-doc1-strategy-dx-bank.pdf" }, { filename: "case7-doc3-it-cloud-migration.pdf" }];
    expect(recallHit(exp, two)).toMatchObject({ hit: false, missing: ["case7-doc4"] });
    const three = [...two, { filename: "case7-doc4-sales-proposal-retail.pdf" }];
    expect(recallHit(exp, three).hit).toBe(true);
  });

  it("saysNotFound / rlsHolds", () => {
    expect(saysNotFound(NOT_FOUND_MESSAGE)).toBe(true);
    expect(saysNotFound("医療向けの提案書は、doc1 です")).toBe(false);
    expect(rlsHolds([{ department: "人事" }], ["人事"])).toBe(true);
    expect(rlsHolds([{ department: "人事" }, { department: "IT" }], ["人事"])).toBe(false);
    expect(rlsHolds([], ["人事"])).toBe(true);
  });

  it("summarize: 検索9問のうち8問当たれば 89% で合格、7問なら不合格", () => {
    const row = (no: number, kind: EvalRow["kind"], pass: boolean): EvalRow => ({ no, question: "", kind, expected: "", pass, detail: "", topFiles: [] });
    const make = (hits: number) => [
      ...Array.from({ length: 9 }, (_, i) => row(i + 1, i === 8 ? "multi" : "single", i < hits)),
      row(10, "none", true), row(11, "none", true), row(12, "rls", true),
    ];
    expect(summarize(make(8))).toMatchObject({ recallHits: 8, recallTotal: 9, passRecall: true, noneHits: 2, rlsPass: true });
    expect(summarize(make(7)).passRecall).toBe(false);
  });
});

// ---------- admin auth / bearer ----------
describe("auth helpers", () => {
  const req = (headers: Record<string, string>) => new Request("http://x", { headers });
  it("合言葉が合っているときだけ通る", () => {
    vi.stubEnv("ADMIN_PASSWORD", "himitsu");
    expect(checkAdminPassword(req({ "x-admin-password": "himitsu" }))).toBe(true);
    expect(checkAdminPassword(req({ "x-admin-password": "chigau" }))).toBe(false);
    expect(checkAdminPassword(req({}))).toBe(false);
  });
  it("合言葉が未設定なら、設定の漏れとして止まる(誰でも通してしまわない)", () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(() => checkAdminPassword(req({ "x-admin-password": "" }))).toThrow(ConfigError);
  });
  it("Bearer トークンを取り出す", () => {
    expect(bearerToken(req({ authorization: "Bearer abc.def" }))).toBe("abc.def");
    expect(bearerToken(req({}))).toBeNull();
    expect(bearerToken(req({ authorization: "Basic xxx" }))).toBeNull();
  });
});

// ---------- ingest(偽のデータベースと、偽のEmbeddingで) ----------
type Call = { table: string; op: string; payload?: unknown; filter?: [string, unknown] };

function fakeAdmin(opts: { existing?: boolean; failChunks?: boolean } = {}) {
  const calls: Call[] = [];
  const admin = {
    from(table: string) {
      return {
        select() {
          return { eq: async (col: string, val: unknown) => { calls.push({ table, op: "select", filter: [col, val] }); return { data: opts.existing ? [{ id: "old" }] : [], error: null }; } };
        },
        delete() {
          return { eq: async (col: string, val: unknown) => { calls.push({ table, op: "delete", filter: [col, val] }); return { error: null }; } };
        },
        insert(payload: unknown) {
          calls.push({ table, op: "insert", payload });
          if (table === "kb_documents") return { select: () => ({ single: async () => ({ data: { id: "doc-1" }, error: null }) }) };
          return Promise.resolve({ error: opts.failChunks ? { message: "chunk insert failed" } : null });
        },
      };
    },
  };
  return { admin: admin as never, calls };
}

const fakeEmbed = async (texts: string[]) => texts.map((_t, i) => vec(i));

describe("ingestPdf", () => {
  const fixture = async (n: number, name: string) => ({ filename: name, pages: await extractPages(readFileSync(`tests/fixtures/${name}`)) , n });

  it("実際のPDFを、章ごとに保存する(部署はPDFの1行目から)", async () => {
    const { admin, calls } = fakeAdmin();
    const { filename, pages } = await fixture(1, "case7-doc2-hr-engagement-report.pdf");
    const r = await ingestPdf({ filename, pages }, { admin, embed: fakeEmbed });
    expect(r).toMatchObject({ department: "人事", chunkCount: 5, replaced: false });
    const docInsert = calls.find((c) => c.table === "kb_documents" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(docInsert).toMatchObject({ filename, department: "人事", client: "製造業B", confidentiality: "社外秘" });
    const chunkRows = calls.find((c) => c.table === "kb_chunks")!.payload as { document_id: string; embedding: string; content: string }[];
    expect(chunkRows).toHaveLength(5);
    expect(chunkRows.every((c) => c.document_id === "doc-1")).toBe(true);
    expect(JSON.parse(chunkRows[0].embedding)).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("部署を指定すると、PDFの1行目より優先する", async () => {
    const { admin } = fakeAdmin();
    const { filename, pages } = await fixture(1, "case7-doc3-it-cloud-migration.pdf");
    const r = await ingestPdf({ filename, pages, department: "管理" }, { admin, embed: fakeEmbed });
    expect(r.department).toBe("管理");
  });

  it("同じファイル名がすでにあれば、消してから入れ直す", async () => {
    const { admin, calls } = fakeAdmin({ existing: true });
    const { filename, pages } = await fixture(1, "case7-doc1-strategy-dx-bank.pdf");
    const r = await ingestPdf({ filename, pages }, { admin, embed: fakeEmbed });
    expect(r.replaced).toBe(true);
    const ops = calls.map((c) => `${c.table}:${c.op}`);
    expect(ops.indexOf("kb_documents:delete")).toBeLessThan(ops.indexOf("kb_documents:insert"));
  });

  it("Embeddingに失敗したら、データベースには何も書かない(古いデータも消さない)", async () => {
    const { admin, calls } = fakeAdmin({ existing: true });
    const { filename, pages } = await fixture(1, "case7-doc1-strategy-dx-bank.pdf");
    await expect(ingestPdf({ filename, pages }, { admin, embed: async () => { throw new EmbeddingError("x"); } })).rejects.toThrow(EmbeddingError);
    expect(calls).toHaveLength(0);
  });

  it("章の保存に失敗したら、文書も消して、中途半端に残さない", async () => {
    const { admin, calls } = fakeAdmin({ failChunks: true });
    const { filename, pages } = await fixture(1, "case7-doc1-strategy-dx-bank.pdf");
    await expect(ingestPdf({ filename, pages }, { admin, embed: fakeEmbed })).rejects.toThrow(/章の保存/);
    expect(calls.at(-1)).toMatchObject({ table: "kb_documents", op: "delete", filter: ["id", "doc-1"] });
  });

  it("部署が分からないとき・章が無いとき・文字が取れないときは、分かる言葉で止まる", async () => {
    const { admin } = fakeAdmin();
    const deps = { admin, embed: fakeEmbed };
    await expect(ingestPdf({ filename: "a.pdf", pages: ["題名\n1. 章\n本文あり"] }, deps)).rejects.toThrow(/部署が決まりません/);
    await expect(ingestPdf({ filename: "a.pdf", pages: ["題名\n部署: IT\nただの文章"] }, deps)).rejects.toThrow(/章.*見つから/);
    await expect(ingestPdf({ filename: "a.pdf", pages: ["", "  "] }, deps)).rejects.toThrow(/文字を取り出せません/);
    await expect(ingestPdf({ filename: "a.pdf" }, deps)).rejects.toBeInstanceOf(IngestError);
  });
});
