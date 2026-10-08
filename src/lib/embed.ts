// 文章を数値(ベクトル)に変える。OpenAI の text-embedding-3-small(1536次元)を使う。
// SQL の vector(1536) と、次元数が合っている必要がある。
import { requireEnv } from "./env";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 64;

export type Embedder = (texts: string[]) => Promise<number[][]>;

export class EmbeddingError extends Error {}

type Fetch = typeof fetch;

export function makeOpenAIEmbedder(fetchImpl: Fetch = fetch): Embedder {
  return async (texts) => {
    const apiKey = requireEnv("OPENAI_API_KEY");
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const res = await fetchImpl("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        if (res.status === 401) throw new EmbeddingError("OpenAI のAPIキーが正しくありません。OPENAI_API_KEY を確認してください。");
        if (res.status === 429)
          throw new EmbeddingError("OpenAI の利用上限か、残高不足です。OpenAI の Billing で、チャージの残高を確認してください。");
        throw new EmbeddingError(`OpenAI のEmbeddingでエラーが出ました(${res.status})。${detail.slice(0, 200)}`);
      }
      const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      const sorted = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (sorted.length !== batch.length) throw new EmbeddingError("Embeddingの結果の数が、送った数と合いません。");
      for (const v of sorted) {
        if (v.length !== EMBEDDING_DIMENSIONS) throw new EmbeddingError(`Embeddingの次元数が ${v.length} でした(期待: ${EMBEDDING_DIMENSIONS})。`);
      }
      out.push(...sorted);
    }
    return out;
  };
}

export const embedTexts: Embedder = (texts) => makeOpenAIEmbedder()(texts);
