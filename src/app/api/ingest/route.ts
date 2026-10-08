import { NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/admin-auth";
import { ConfigError } from "@/lib/env";
import { EmbeddingError, embedTexts } from "@/lib/embed";
import { IngestError, ingestPdf } from "@/lib/ingest";
import { adminClient } from "@/lib/supabase-server";

export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024; // Vercel の関数に送れる大きさの上限が約4.5MB

// 管理用: PDF を1つ受け取って、取り込む(合言葉が必要)
export async function POST(req: Request) {
  try {
    if (!checkAdminPassword(req)) return NextResponse.json({ error: "合言葉が違います。" }, { status: 401 });

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "PDFファイルを選んでください。" }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".pdf")) return NextResponse.json({ error: "PDFファイルだけ取り込めます。" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "ファイルが大きすぎます(上限は4MBです)。" }, { status: 413 });

    const department = form?.get("department");
    const result = await ingestPdf(
      {
        filename: file.name,
        buffer: Buffer.from(await file.arrayBuffer()),
        department: typeof department === "string" && department ? department : null,
      },
      { admin: adminClient(), embed: embedTexts },
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof IngestError) return NextResponse.json({ error: e.message }, { status: 422 });
    if (e instanceof ConfigError || e instanceof EmbeddingError) return NextResponse.json({ error: e.message }, { status: 500 });
    console.error(e);
    return NextResponse.json({ error: (e as Error).message || "エラーが出ました。" }, { status: 500 });
  }
}
