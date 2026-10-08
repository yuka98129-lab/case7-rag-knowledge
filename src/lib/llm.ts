import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "./env";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompts";
import type { MatchedChunk } from "./retrieve";

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export class LlmError extends Error {}

export type Answerer = (question: string, chunks: MatchedChunk[]) => Promise<string>;

export const answerWithClaude: Answerer = async (question, chunks) => {
  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(question, chunks) }],
    });
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) throw new LlmError("Claude のAPIキーが正しくありません。ANTHROPIC_API_KEY を確認してください。");
    if (status === 404)
      throw new LlmError(`Claude のモデル名「${model}」が見つかりません。Vercel の環境変数 ANTHROPIC_MODEL に、使えるモデル名を入れて、再公開してください。`);
    if (status === 429 || status === 529) throw new LlmError("Claude が混み合っているか、利用上限です。少し待ってから、もう一度試してください。");
    throw new LlmError(`Claude でエラーが出ました: ${(e as Error).message}`);
  }
};
