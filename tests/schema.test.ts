// Supabase の SQL(schema.sql)が、部署の制限をきちんと効かせるかを、手元で確かめるテスト。
// 本物の Supabase ではなく、PGlite(Postgres + pgvector)に、Supabase の auth まわりを真似て作ってある。
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { beforeAll, describe, expect, it } from "vitest";

const SCHEMA = readFileSync("supabase/schema.sql", "utf8");
const HR = "00000000-0000-0000-0000-0000000000a1";
const IT = "00000000-0000-0000-0000-0000000000b2";
const NOBODY = "00000000-0000-0000-0000-0000000000c3";

// 1536次元の、向きがはっきり違うダミーのベクトル(次元 i だけ 1)
const vec = (i: number) => `[${Array.from({ length: 1536 }, (_, k) => (k === i ? 1 : 0)).join(",")}]`;

let db: PGlite;

async function asUser(uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  // Supabase が最初から用意しているものを、真似て作る
  await db.exec(`
    create schema extensions;
    create schema auth;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public, extensions, auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated;
    set search_path = public, extensions;
    -- Supabase は、public に作った表へ、最初から広い権限を付ける。それも真似る
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  `);
  await db.exec(SCHEMA);
  await db.exec(`
    insert into auth.users values ('${HR}', 'hr@example.com'), ('${IT}', 'it@example.com'), ('${NOBODY}', 'none@example.com');
    insert into kb_user_departments values ('${HR}', '人事'), ('${IT}', 'IT');
    insert into kb_documents (id, filename, title, department) values
      ('11111111-1111-1111-1111-111111111111', 'hr.pdf', '人事の報告書', '人事'),
      ('22222222-2222-2222-2222-222222222222', 'it.pdf', 'ITの報告書', 'IT');
    insert into kb_chunks (document_id, section_title, content, embedding) values
      ('11111111-1111-1111-1111-111111111111', '1. 人事A', '人事の本文A', '${vec(0)}'),
      ('11111111-1111-1111-1111-111111111111', '2. 人事B', '人事の本文B', '${vec(1)}'),
      ('22222222-2222-2222-2222-222222222222', '1. IT A', 'ITの本文A', '${vec(2)}'),
      ('22222222-2222-2222-2222-222222222222', '2. IT B', 'ITの本文B', '${vec(3)}');
  `);
}, 60_000);

describe("schema.sql", () => {
  it("もう一度実行しても、エラーにならない(何度でも実行できる)", async () => {
    await expect(db.exec(SCHEMA)).resolves.toBeDefined();
  });

  it("人事の人は、人事の文書とチャンクだけが見える", async () => {
    const docs = await asUser(HR, "select filename from kb_documents order by 1");
    expect(docs.rows).toEqual([{ filename: "hr.pdf" }]);
    const chunks = await asUser(HR, "select section_title from kb_chunks order by 1");
    expect(chunks.rows.map((r: any) => r.section_title)).toEqual(["1. 人事A", "2. 人事B"]);
  });

  it("ITの人は、ITの文書だけが見える", async () => {
    const docs = await asUser(IT, "select filename from kb_documents");
    expect(docs.rows).toEqual([{ filename: "it.pdf" }]);
  });

  it("どの部署にも入っていない人は、何も見えない", async () => {
    expect((await asUser(NOBODY, "select * from kb_documents")).rows).toHaveLength(0);
    expect((await asUser(NOBODY, "select * from kb_chunks")).rows).toHaveLength(0);
  });

  it("ベクトル検索でも、部署の制限が効く(ITのチャンクと完全に一致する質問でも、人事の人には出ない)", async () => {
    const hr = await asUser(HR, "select section_title, similarity from kb_match_chunks($1::vector, 5)", [vec(2)]);
    expect(hr.rows.map((r: any) => r.section_title).sort()).toEqual(["1. 人事A", "2. 人事B"]);
    const it = await asUser(IT, "select section_title from kb_match_chunks($1::vector, 5)", [vec(2)]);
    expect((it.rows[0] as any).section_title).toBe("1. IT A"); // 一番近いものが先頭
    expect(it.rows).toHaveLength(2);
  });

  it("一番近いものが先頭に来て、似ている度合い(similarity)が 1 に近い", async () => {
    const r = await asUser(HR, "select section_title, similarity from kb_match_chunks($1::vector, 5)", [vec(1)]);
    expect((r.rows[0] as any).section_title).toBe("2. 人事B");
    expect((r.rows[0] as any).similarity).toBeCloseTo(1, 5);
  });

  it("ログインしていない人(anon)は、読めない・検索できない", async () => {
    await expect(asUser(null, "select * from kb_documents")).rejects.toThrow(/permission denied/);
    await expect(asUser(null, "select * from kb_match_chunks($1::vector, 5)", [vec(0)])).rejects.toThrow(/permission denied/);
  });

  it("ログインしている人でも、ブラウザ側からは、書き込めない", async () => {
    await expect(
      asUser(HR, "insert into kb_documents (filename, title, department) values ('x.pdf', 'x', '人事')"),
    ).rejects.toThrow();
    await expect(asUser(HR, "delete from kb_documents")).rejects.toThrow();
    await expect(asUser(HR, "insert into kb_user_departments values ($1, 'IT')", [HR])).rejects.toThrow();
  });

  it("自分の所属部署の表は、自分の分だけ見える", async () => {
    const r = await asUser(HR, "select user_id, department from kb_user_departments");
    expect(r.rows).toEqual([{ user_id: HR, department: "人事" }]);
  });

  it("管理用の鍵(service_role)なら、書き込める", async () => {
    await db.exec("reset role; set role service_role;");
    try {
      await db.exec(
        "insert into kb_documents (filename, title, department) values ('sales.pdf', '営業', '営業')",
      );
    } finally {
      await db.exec("reset role;");
    }
    const r = await db.query("select count(*)::int as n from kb_documents");
    expect((r.rows[0] as any).n).toBe(3);
  });

  it("管理用の鍵(service_role)は、全部署の文書を対象に、ベクトル検索できる(精度の測定用)", async () => {
    await db.exec("reset role; set role service_role;");
    try {
      const r = await db.query("select department from kb_match_chunks($1::vector, 20)", [vec(2)]);
      const depts = new Set(r.rows.map((x: any) => x.department));
      expect(depts.has("人事")).toBe(true);
      expect(depts.has("IT")).toBe(true);
    } finally {
      await db.exec("reset role;");
    }
  });

  it("同じファイル名は、二重に取り込めない", async () => {
    await expect(
      db.exec("insert into kb_documents (filename, title, department) values ('hr.pdf', 'dup', '人事')"),
    ).rejects.toThrow(/unique|duplicate/);
  });

  it("存在しない部署名は、入れられない", async () => {
    await expect(
      db.exec("insert into kb_documents (filename, title, department) values ('z.pdf', 'z', '総務')"),
    ).rejects.toThrow(/check/);
  });
});

describe("監査ログ(query_logs)", () => {
  const CHUNK_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const CHUNK_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  async function asService(sql: string, params: unknown[] = []) {
    await db.exec("reset role; set role service_role;");
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec("reset role;");
    }
  }

  it("管理用の鍵(サーバー)は、ログを書ける・読める", async () => {
    await asService(
      "insert into query_logs (user_id, user_department, query, retrieved_chunk_ids, channel) values ($1, '人事', '質問A', $2::uuid[], 'web')",
      [HR, `{${CHUNK_A},${CHUNK_B}}`],
    );
    const r = await asService("select user_id, user_department, query, retrieved_chunk_ids, channel, created_at from query_logs");
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0] as any;
    expect(row.user_id).toBe(HR);
    expect(row.query).toBe("質問A");
    expect(row.retrieved_chunk_ids).toEqual([CHUNK_A, CHUNK_B]);
    expect(row.created_at).toBeTruthy();
  });

  it("ログインしている人でも、ログを読めない・書けない・書き換えられない(自分のログも)", async () => {
    await expect(asUser(HR, "select * from query_logs")).rejects.toThrow(/permission denied/);
    await expect(asUser(HR, "insert into query_logs (user_id, query) values ($1, 'x')", [HR])).rejects.toThrow(/permission denied/);
    await expect(asUser(HR, "update query_logs set query = 'x'")).rejects.toThrow(/permission denied/);
    await expect(asUser(HR, "delete from query_logs")).rejects.toThrow(/permission denied/);
  });

  it("ログインしていない人(anon)も、触れない", async () => {
    await expect(asUser(null, "select * from query_logs")).rejects.toThrow(/permission denied/);
  });

  it("チャンネルは web か slack だけ。質問が空(null)のログは作れない", async () => {
    await expect(asService("insert into query_logs (query, channel) values ('x', 'email')")).rejects.toThrow();
    await expect(asService("insert into query_logs (query) values (null)")).rejects.toThrow();
  });

  it("ユーザーを消しても、ログは残る(user_id が null になる)", async () => {
    const GONE = "00000000-0000-0000-0000-0000000000d4";
    await db.exec(`insert into auth.users values ('${GONE}', 'gone@example.com')`);
    await asService("insert into query_logs (user_id, query) values ($1, '消えるユーザーの質問')", [GONE]);
    await db.exec(`delete from auth.users where id = '${GONE}'`);
    const r = await asService("select user_id from query_logs where query = '消えるユーザーの質問'");
    expect(r.rows).toEqual([{ user_id: null }]);
  });

  it("ガバナンス手順: 削除した文書のチャンクIDを、ログから消せる(redact)", async () => {
    await asService(
      "update query_logs set retrieved_chunk_ids = array_remove(retrieved_chunk_ids, $1::uuid) where $1::uuid = any(retrieved_chunk_ids)",
      [CHUNK_A],
    );
    const r = await asService("select retrieved_chunk_ids from query_logs where query = '質問A'");
    expect((r.rows[0] as any).retrieved_chunk_ids).toEqual([CHUNK_B]);
  });

  it("月次集計の SQL が、部署ごとの件数を返す", async () => {
    const r = await asService(
      `select coalesce(user_department, '(不明)') as dept, count(*)::int as n
         from query_logs where created_at >= date_trunc('month', now()) group by 1 order by 2 desc`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
  });
});
