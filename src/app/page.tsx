"use client";

import { useState } from "react";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { authHeader, useSession } from "@/lib/use-session";

type Source = {
  filename: string;
  title: string;
  department: string;
  section: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  similarity: number;
};
// 答えに、太字の記号(**)などが混ざっても、そのまま見えないようにする
const plain = (t: string) => t.replace(/\*\*/g, "").replace(/^#+\s*/gm, "");

type Result = { answer: string; sources: Source[] };

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getBrowserSupabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === "Invalid login credentials" ? "メールアドレスまたはパスワードが違います。" : `ログインできませんでした: ${error.message}`);
  }

  return (
    <form onSubmit={submit} className="card">
      <h2 style={{ marginTop: 0 }}>ログイン</h2>
      <label>
        メールアドレス
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        パスワード
        <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "ログインしています…" : "ログイン"}
      </button>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
    </form>
  );
}

function AskForm() {
  const { session } = useSession();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(session) },
        body: JSON.stringify({ question }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "エラーが出ました。");
      else setResult(json as Result);
    } catch {
      setError("通信できませんでした。ネットワークを確認して、もう一度試してください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={ask} className="card">
        <label htmlFor="q" style={{ marginTop: 0 }}>
          質問を入力してください
        </label>
        <textarea id="q" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="例: 窓口業務のデジタル化で、人件費はどれくらい削減できる見込みですか?" />
        <button type="submit" disabled={busy || !question.trim()}>
          {busy ? "考え中…(5〜10秒かかります)" : "質問する"}
        </button>
      </form>

      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}

      {result && (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>答え</h2>
            <p className="answer">{plain(result.answer)}</p>
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>探した章(上位{result.sources.length}件)</h2>
            {result.sources.length === 0 && <p className="muted">あなたの部署で見られる文書がありません。</p>}
            {result.sources.map((s, i) => (
              <div className="source" key={i}>
                <span className="tag">{s.department}</span>
                {s.filename}
                {s.pageStart != null && ` p.${s.pageStart}-${s.pageEnd ?? s.pageStart}`}
                <br />
                <span className="muted">
                  {s.section ?? "章なし"} / 近さ: {s.similarity}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function Home() {
  const { loading, session, configured } = useSession();

  return (
    <main>
      <h1>ナレッジ検索</h1>
      <p className="muted">過去の提案書・報告書を、あなたの部署で見られるものだけから探して、出典つきで答えます。</p>
      <nav>
        <Link href="/admin">文書の取り込み</Link>
        <Link href="/eval">精度の測定</Link>
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

      {!configured && (
        <p role="alert" className="alert error">
          Supabase の設定がありません。Vercel の環境変数 NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を登録して、再公開(Redeploy)してください。
        </p>
      )}
      {configured && loading && <p className="muted">読み込み中…</p>}
      {configured && !loading && !session && <LoginForm />}
      {configured && !loading && session && <AskForm />}
    </main>
  );
}
