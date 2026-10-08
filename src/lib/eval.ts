// 精度の測定(Recall@5など)の、計算の部分。画面や通信とは切り離して、テストしやすくしている。
import type { TestQuestion } from "@/data/test-questions";
import { NOT_FOUND_MESSAGE } from "./prompts";
import type { MatchedChunk } from "./retrieve";

export type QuestionKind = "single" | "multi" | "none" | "rls";

export function kindOf(q: TestQuestion): QuestionKind {
  if (q.kind.includes("RLS")) return "rls";
  if (q.kind.includes("該当なし")) return "none";
  if (q.kind.includes("複数文書")) return "multi";
  return "single";
}

/** 「case7-doc1 / case7-doc3」のような正解の書き方を、文書名の先頭の部分の一覧にする */
export function expectedPrefixes(expected: string): string[] {
  return expected
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

const stripExt = (name: string) => name.replace(/\.pdf$/i, "");

/** 上位の結果に、正解の文書がすべて含まれているか。複数文書の質問は、全部そろって初めて「当たり」 */
export function recallHit(expected: string, top: Pick<MatchedChunk, "filename">[]): { hit: boolean; found: string[]; missing: string[] } {
  const prefixes = expectedPrefixes(expected);
  const names = top.map((c) => stripExt(c.filename));
  const found = prefixes.filter((p) => names.some((n) => n.startsWith(p)));
  const missing = prefixes.filter((p) => !found.includes(p));
  return { hit: prefixes.length > 0 && missing.length === 0, found, missing };
}

/** 答えが「該当なし」になっているか(でっち上げていないか) */
export const saysNotFound = (answer: string) => answer.includes(NOT_FOUND_MESSAGE);

/** RLS の確認: 返ってきた結果が、すべて「自分の所属部署」の文書か */
export function rlsHolds(top: Pick<MatchedChunk, "department">[], myDepartments: string[]): boolean {
  return top.every((c) => myDepartments.includes(c.department));
}

export type EvalRow = {
  no: number;
  question: string;
  kind: QuestionKind;
  expected: string;
  pass: boolean;
  detail: string;
  topFiles: string[];
};

export type EvalSummary = {
  recallHits: number;
  recallTotal: number;
  recallRate: number;
  passRecall: boolean;
  noneHits: number;
  noneTotal: number;
  rlsPass: boolean | null;
};

export const RECALL_PASS_LINE = 0.8;

export function summarize(rows: EvalRow[]): EvalSummary {
  const recall = rows.filter((r) => r.kind === "single" || r.kind === "multi");
  const none = rows.filter((r) => r.kind === "none");
  const rls = rows.find((r) => r.kind === "rls");
  const hits = recall.filter((r) => r.pass).length;
  const rate = recall.length ? hits / recall.length : 0;
  return {
    recallHits: hits,
    recallTotal: recall.length,
    recallRate: rate,
    passRecall: rate >= RECALL_PASS_LINE,
    noneHits: none.filter((r) => r.pass).length,
    noneTotal: none.length,
    rlsPass: rls ? rls.pass : null,
  };
}
