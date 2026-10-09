import { NextResponse } from "next/server";
import { ConfigError } from "@/lib/env";
import { EmbeddingError, embedTexts } from "@/lib/embed";
import { LlmError, answerWithClaude } from "@/lib/llm";
import { retrieve } from "@/lib/retrieve";
import { AuditError, departmentsOf, writeQueryLog } from "@/lib/audit";
import { adminClient, authenticate } from "@/lib/supabase-server";

export const maxDuration = 60;

// 質問を受けて、ログインした人が見てよい文書だけから探し、出典つきで答える
export async function POST(req: Request) {
  try {
    const session = await authenticate(req);
    if (!session) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { question?: unknown } | null;
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question) return NextResponse.json({ error: "質問を入力してください。" }, { status: 400 });
    if (question.length > 500) return NextResponse.json({ error: "質問は500文字以内にしてください。" }, { status: 400 });

    const [embedding] = await embedTexts([question]);
    const chunks = await retrieve(session.client, embedding); // ← ログインした人の権限で検索(部署の制限が効く)

    // 監査ログ: 検索のあと、回答を作る前に保存する。保存できなければ、回答は返さない(ログに残らない回答を出さない)
    await writeQueryLog(adminClient(), {
      userId: session.user.id,
      userDepartment: await departmentsOf(session.client, session.user.id),
      query: question,
      retrievedChunkIds: chunks.map((c) => c.id),
      channel: "web",
    });

    const answer = await answerWithClaude(question, chunks);

    return NextResponse.json({
      answer,
      sources: chunks.map((c) => ({
        filename: c.filename,
        title: c.title,
        department: c.department,
        section: c.section_title,
        pageStart: c.page_start,
        pageEnd: c.page_end,
        similarity: Math.round(c.similarity * 1000) / 1000,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

function errorResponse(e: unknown) {
  if (e instanceof ConfigError || e instanceof EmbeddingError || e instanceof LlmError || e instanceof AuditError)
    return NextResponse.json({ error: e.message }, { status: 500 });
  console.error(e);
  return NextResponse.json({ error: (e as Error).message || "エラーが出ました。" }, { status: 500 });
}
