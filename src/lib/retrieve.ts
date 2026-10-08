import type { SupabaseClient } from "@supabase/supabase-js";

export type MatchedChunk = {
  id: string;
  document_id: string;
  filename: string;
  title: string;
  department: string;
  section_title: string | null;
  content: string;
  page_start: number | null;
  page_end: number | null;
  similarity: number;
};

export const TOP_K = 5;

/**
 * 質問に近いチャンクを、上位 k 件探す。
 * 渡す client が「ログインした人の権限」なら、その人が見てよい文書のチャンクしか返らない(RLS)。
 */
export async function retrieve(client: SupabaseClient, embedding: number[], k = TOP_K): Promise<MatchedChunk[]> {
  const { data, error } = await client.rpc("kb_match_chunks", {
    query_embedding: JSON.stringify(embedding),
    match_count: k,
  });
  if (error) throw new Error(`検索でエラーが出ました: ${error.message}`);
  return (data ?? []) as MatchedChunk[];
}
