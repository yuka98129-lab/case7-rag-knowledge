"use client";

import { useState } from "react";
import Link from "next/link";
import { DEPARTMENTS } from "@/lib/departments";

type Row = { name: string; status: "waiting" | "running" | "done" | "error"; message: string };

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [department, setDepartment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;
    setBusy(true);
    setRows(files.map((f) => ({ name: f.name, status: "waiting", message: "待っています" })));
    for (let i = 0; i < files.length; i++) {
      update(i, { status: "running", message: "取り込んでいます…" });
      const form = new FormData();
      form.append("file", files[i]);
      if (department) form.append("department", department);
      try {
        const res = await fetch("/api/ingest", { method: "POST", headers: { "x-admin-password": password }, body: form });
        const json = await res.json();
        if (!res.ok) update(i, { status: "error", message: json.error ?? "エラーが出ました。" });
        else
          update(i, {
            status: "done",
            message: `${json.department}部門として、${json.chunkCount}個の章を取り込みました${json.replaced ? "(同じ名前の文書を入れ替えました)" : ""}`,
          });
      } catch {
        update(i, { status: "error", message: "通信できませんでした。" });
      }
    }
    setBusy(false);
  }

  return (
    <main>
      <h1>文書の取り込み</h1>
      <p className="muted">PDFを、章ごとに切り分けて、検索できる状態にします(管理用)。</p>
      <nav>
        <Link href="/">← 質問の画面へ</Link>
      </nav>

      <form onSubmit={run} className="card">
        <label htmlFor="pw" style={{ marginTop: 0 }}>
          合言葉(ADMIN_PASSWORD に登録したもの)
        </label>
        <input id="pw" type="password" autoComplete="off" required value={password} onChange={(e) => setPassword(e.target.value)} />

        <label htmlFor="dept">部署</label>
        <select id="dept" value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">自動(PDFの1行目の「部署:」を使う)</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <label htmlFor="files">PDFファイル(複数選べます。1つ4MBまで)</label>
        <input id="files" type="file" accept="application/pdf,.pdf" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />

        <button type="submit" disabled={busy || files.length === 0 || !password}>
          {busy ? "取り込んでいます…" : `${files.length}件を取り込む`}
        </button>
      </form>

      {rows.length > 0 && (
        <div className="card">
          <table>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td className={r.status === "done" ? "pass" : r.status === "error" ? "fail" : "muted"}>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
