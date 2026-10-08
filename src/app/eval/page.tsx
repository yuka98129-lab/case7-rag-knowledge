"use client";

import { useState } from "react";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { authHeader, useSession } from "@/lib/use-session";

type Row = { no: number; question: string; kind: string; expected: string; pass: boolean; detail: string; topFiles: string[] };
type Summary = {
  recallHits: number;
  recallTotal: number;
  recallRate: number;
  passRecall: boolean;
  noneHits: number;
  noneTotal: number;
  rlsPass: boolean | null;
};
type Result = { rows: Row[]; summary: Summary; myDepartments: string[] };

const KIND_LABEL: Record<string, string> = { single: "検索", multi: "検索(複数文書)", none: "該当なし", rls: "部署の制限" };

export default function EvalPage() {
  const { session, loading, configured } = useSession();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/eval", { method: "POST", headers: { "x-admin-password": password, ...authHeader(session) } });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "エラーが出ました。");
      else setResult(json as Result);
    } catch {
      setError("通信できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  const s = result?.summary;

  return (
    <main>
      <h1>精度の測定</h1>
      <p className="muted">課題のテスト質問12問で、検索の当たり具合(Recall@5)と、部署の制限を確かめます。</p>
      <nav>
        <Link href="/">← 質問の画面へ</Link>
        {session && (
          <>
            <span className="muted">{session.user.email}</span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                void getBrowserSupabase().auth.signOut();
              }}
            >
              ログアウト
            </a>
          </>
        )}
      </nav>

      {configured && !loading && !session && (
        <p className="alert error">部署の制限の確認に、ログインが必要です。<Link href="/">質問の画面</Link>でログインしてから、戻ってきてください。</p>
      )}

      <form onSubmit={run} className="card">
        <label htmlFor="pw" style={{ marginTop: 0 }}>
          合言葉(ADMIN_PASSWORD)
        </label>
        <input id="pw" type="password" autoComplete="off" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" disabled={busy || !session || !password}>
          {busy ? "測っています…(1分ほどかかります)" : "12問を実行する"}
        </button>
      </form>

      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}

      {s && result && (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>結果</h2>
            <p>
              <strong>Recall@5: {Math.round(s.recallRate * 100)}%</strong>({s.recallHits} / {s.recallTotal}問)
              <span className={s.passRecall ? "pass" : "fail"}> {s.passRecall ? "合格(80%以上)" : "あと少し(80%未満)"}</span>
            </p>
            <p>
              該当なしの質問: {s.noneHits} / {s.noneTotal}問で、でっち上げずに「該当なし」と答えました。
            </p>
            <p>
              部署の制限: <span className={s.rlsPass ? "pass" : "fail"}>{s.rlsPass ? "効いています" : "要確認"}</span>
              <span className="muted">(あなたの部署: {result.myDepartments.join("、") || "なし"})</span>
            </p>
          </div>

          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>質問</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.no}>
                    <td>{r.no}</td>
                    <td>
                      <span className="tag">{KIND_LABEL[r.kind] ?? r.kind}</span>
                      {r.question}
                      <div className="muted">{r.detail}</div>
                      {r.topFiles.length > 0 && <div className="muted">上位: {r.topFiles.map((f) => f.replace(/^case7-|\.pdf$/g, "")).join(" / ")}</div>}
                    </td>
                    <td className={r.pass ? "pass" : "fail"}>{r.pass ? "OK" : "NG"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
