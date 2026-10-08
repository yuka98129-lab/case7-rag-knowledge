// PDF 1つを、取り込む: ページごとの文字 → 章ごとに切る → 数値にする → データベースに保存。
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkPages, type ChunkOptions } from "./ingestion/chunker";
import { extractPages } from "./ingestion/pdf";
import { isDepartment, type Department, DEPARTMENTS } from "./departments";
import type { Embedder } from "./embed";

export class IngestError extends Error {}

export type IngestResult = {
  filename: string;
  title: string;
  department: Department;
  chunkCount: number;
  replaced: boolean;
};

export type IngestInput = {
  filename: string;
  /** PDF の中身。テストでは、ページごとの文字列(pages)を直接渡せる */
  buffer?: Buffer;
  pages?: string[];
  /** 指定すると、PDF の1行目の「部署:」より優先する */
  department?: string | null;
};

export type IngestDeps = {
  admin: SupabaseClient;
  embed: Embedder;
  chunkOptions?: ChunkOptions;
  extract?: (buffer: Buffer) => Promise<string[]>;
};

export async function ingestPdf(input: IngestInput, deps: IngestDeps): Promise<IngestResult> {
  const { admin, embed } = deps;
  const extract = deps.extract ?? extractPages;

  const pages = input.pages ?? (input.buffer ? await extract(input.buffer) : null);
  if (!pages) throw new IngestError("PDF の中身がありません。");
  if (pages.every((p) => p.trim() === ""))
    throw new IngestError("このPDFからは、文字を取り出せませんでした(スキャンした画像のPDFかもしれません)。");

  const { meta, chunks } = chunkPages(pages, deps.chunkOptions);
  if (chunks.length === 0)
    throw new IngestError("章(「1.」「第1章」のような見出し)が見つからず、切り分けできませんでした。");

  const department = input.department || meta.department;
  if (!isDepartment(department))
    throw new IngestError(
      `部署が決まりません(PDFの1行目の「部署:」は「${meta.department ?? "なし"}」でした)。次のどれかを選んでください: ${DEPARTMENTS.join("、")}`,
    );

  // 先に数値にする(ここで失敗したら、データベースには何も書かない)
  const embeddings = await embed(chunks.map((c) => c.content));

  // 同じファイル名があれば、いったん消して、入れ直す(章も一緒に消える)
  const { data: existing, error: findError } = await admin.from("kb_documents").select("id").eq("filename", input.filename);
  if (findError) throw new IngestError(`保存先の確認でエラーが出ました: ${findError.message}`);
  const replaced = (existing?.length ?? 0) > 0;
  if (replaced) {
    const { error } = await admin.from("kb_documents").delete().eq("filename", input.filename);
    if (error) throw new IngestError(`古いデータの削除でエラーが出ました: ${error.message}`);
  }

  const { data: doc, error: docError } = await admin
    .from("kb_documents")
    .insert({
      filename: input.filename,
      title: meta.title || input.filename,
      department,
      client: meta.client,
      created_year: meta.createdYear,
      confidentiality: meta.confidentiality,
    })
    .select("id")
    .single();
  if (docError || !doc) throw new IngestError(`文書の保存でエラーが出ました: ${docError?.message ?? "不明"}`);

  const rows = chunks.map((c, i) => ({
    document_id: doc.id,
    section_title: c.sectionTitle,
    content: c.content,
    page_start: c.pageStart,
    page_end: c.pageEnd,
    embedding: JSON.stringify(embeddings[i]),
    metadata: { client: meta.client, created_year: meta.createdYear, confidentiality: meta.confidentiality },
  }));
  const { error: chunkError } = await admin.from("kb_chunks").insert(rows);
  if (chunkError) {
    await admin.from("kb_documents").delete().eq("id", doc.id); // 中途半端に残さない
    throw new IngestError(`章の保存でエラーが出ました: ${chunkError.message}`);
  }

  return { filename: input.filename, title: meta.title, department, chunkCount: chunks.length, replaced };
}
