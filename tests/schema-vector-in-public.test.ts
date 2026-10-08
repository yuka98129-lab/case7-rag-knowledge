// 案件3のプロジェクトでは、pgvector が「public」に入っていて、SQL が途中で止まった。
// 同じ状態(pgvector が最初から public にある)でも、schema.sql が最後まで動くことを確かめる。
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { describe, expect, it } from "vitest";

const SCHEMA = readFileSync("supabase/schema.sql", "utf8");
const HR = "00000000-0000-0000-0000-0000000000a1";
const vec = (i: number) => `[${Array.from({ length: 1536 }, (_, k) => (k === i ? 1 : 0)).join(",")}]`;

async function makeDb(vectorSchema: "public" | "extensions") {
  const db = new PGlite({ extensions: { vector } });
  await db.exec(`
    create schema if not exists extensions;
    create schema auth;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public, extensions, auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create extension vector with schema ${vectorSchema};
  `);
  // 新しい接続の初期状態(search_path は public だけ)から始める
  await db.exec("set search_path = public;");
  return db;
}

describe.each(["public", "extensions"] as const)("pgvector が「%s」にあるとき", (where) => {
  it("schema.sql が最後まで動き、2回目もエラーにならない", async () => {
    const db = await makeDb(where);
    await expect(db.exec(SCHEMA)).resolves.toBeDefined();
    await expect(db.exec(SCHEMA)).resolves.toBeDefined();
  }, 60_000);

  it("部署の制限つきのベクトル検索が、動く", async () => {
    const db = await makeDb(where);
    await db.exec(SCHEMA);
    await db.exec(`
      insert into auth.users values ('${HR}', 'hr@example.com');
      insert into kb_user_departments values ('${HR}', '人事');
      insert into kb_documents (id, filename, title, department) values
        ('11111111-1111-1111-1111-111111111111', 'hr.pdf', '人事', '人事'),
        ('22222222-2222-2222-2222-222222222222', 'it.pdf', 'IT', 'IT');
      insert into kb_chunks (document_id, section_title, content, embedding) values
        ('11111111-1111-1111-1111-111111111111', '人事A', 'a', '${vec(0)}'),
        ('22222222-2222-2222-2222-222222222222', 'IT A', 'b', '${vec(1)}');
    `);
    await db.exec(`select set_config('request.jwt.claim.sub', '${HR}', false); set role authenticated;`);
    const r = await db.query(`select section_title from kb_match_chunks('${vec(1)}'::vector, 5)`);
    await db.exec("reset role;");
    expect(r.rows).toEqual([{ section_title: "人事A" }]);
  }, 60_000);
});
