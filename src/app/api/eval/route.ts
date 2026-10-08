import { NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/admin-auth";
import { TEST_QUESTIONS } from "@/data/test-questions";
import { ConfigError } from "@/lib/env";
import { EmbeddingError, embedTexts } from "@/lib/embed";
import { type EvalRow, kindOf, recallHit, rlsHolds, saysNotFound, summarize } from "@/lib/eval";
import { LlmError, answerWithClaude } from "@/lib/llm";
import { retrieve } from "@/lib/retrieve";
import { adminClient, authenticate } from "@/lib/supabase-server";

export const maxDuration = 120;

// 管理用: テスト質問12問で、精度を測る(合言葉 + ログインが必要)
//   ・検索の当たり具合(Recall@5)は、管理用の鍵で「全部署の文書」を対象に測る(権限に左右されないように)
//   ・部署の制限(RLS)は、ログインしている人の権限で確かめる
export async function POST(req: Request) {
  try {
    if (!checkAdminPassword(req)) return NextResponse.json({ error: "合言葉が違います。" }, { status: 401 });
    const session = await authenticate(req);
    if (!session) return NextResponse.json({ error: "ログインしてください(部署の制限の確認に使います)。" }, { status: 401 });

    const admin = adminClient();
    const { data: mine, error: deptError } = await session.client.from("kb_user_departments").select("department");
    if (deptError) throw new Error(`所属部署の確認でエラーが出ました: ${deptError.message}`);
    const myDepartments = (mine ?? []).map((r: { department: string }) => r.department);

    const embeddings = await embedTexts(TEST_QUESTIONS.map((q) => q.question));
    const rows: EvalRow[] = [];

    for (let i = 0; i < TEST_QUESTIONS.length; i++) {
      const q = TEST_QUESTIONS[i];
      const kind = kindOf(q);
      const base = { no: q.no, question: q.question, kind, expected: q.expected };

      if (kind === "single" || kind === "multi") {
        const top = await retrieve(admin, embeddings[i]);
        const r = recallHit(q.expected, top);
        rows.push({
          ...base,
          pass: r.hit,
          detail: r.hit ? "上位5件に、正解の文書が入っています" : `上位5件に入っていない文書: ${r.missing.join("、")}`,
          topFiles: top.map((c) => c.filename),
        });
      } else if (kind === "none") {
        const top = await retrieve(admin, embeddings[i]);
        const answer = await answerWithClaude(q.question, top);
        const ok = saysNotFound(answer);
        rows.push({ ...base, pass: ok, detail: ok ? "「該当なし」と答えました" : `でっち上げの可能性: ${answer.slice(0, 120)}`, topFiles: top.map((c) => c.filename) });
      } else {
        // 部署の制限: IT のクラウド移行報告書を探しても、自分の部署以外の文書は返らないこと
        const top = await retrieve(session.client, embeddings[i]);
        const ok = rlsHolds(top, myDepartments);
        rows.push({
          ...base,
          pass: ok,
          detail: `あなたの部署: ${myDepartments.join("、") || "なし"} / 見えた文書の部署: ${[...new Set(top.map((c) => c.department))].join("、") || "なし"}`,
          topFiles: top.map((c) => c.filename),
        });
      }
    }
    return NextResponse.json({ rows, summary: summarize(rows), myDepartments });
  } catch (e) {
    if (e instanceof ConfigError || e instanceof EmbeddingError || e instanceof LlmError)
      return NextResponse.json({ error: e.message }, { status: 500 });
    console.error(e);
    return NextResponse.json({ error: (e as Error).message || "エラーが出ました。" }, { status: 500 });
  }
}
