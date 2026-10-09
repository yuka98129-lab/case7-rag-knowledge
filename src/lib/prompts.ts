import type { MatchedChunk } from "./retrieve";

export const NOT_FOUND_MESSAGE = "該当情報が見つかりませんでした";

export const SYSTEM_PROMPT = `あなたは、コンサルティング会社の社内ナレッジ検索のアシスタントです。
「参考資料」に書かれていることだけを根拠に、質問に日本語で答えてください。

ルール:
- 参考資料に書かれていないことは、推測や一般知識で補わない。数字や固有名詞は、資料のとおりに書く。
- 回答の最後に、必ず「出典:」の行を付け、使った資料を「ファイル名 p.開始ページ-終了ページ」の形で、すべて並べる。
- 参考資料に、質問に答えられる情報がない場合は、「${NOT_FOUND_MESSAGE}」とだけ答える。出典の行は付けない。
- 複数の文書にまたがる質問には、文書ごとに分けて答える。
- Markdown の記号(** や # など)は使わず、ふつうの文章で書く。`;

export function formatChunk(c: MatchedChunk, index: number): string {
  const pages =
    c.page_start == null ? "" : c.page_end != null && c.page_end !== c.page_start ? ` p.${c.page_start}-${c.page_end}` : ` p.${c.page_start}-${c.page_start}`;
  return `[資料${index + 1}] ${c.filename}${pages}(${c.section_title ?? "章なし"})\n${c.content}`;
}

export function buildUserMessage(question: string, chunks: MatchedChunk[]): string {
  const refs = chunks.length > 0 ? chunks.map(formatChunk).join("\n\n") : "(参考資料はありません)";
  return `参考資料:\n${refs}\n\n質問: ${question}`;
}
