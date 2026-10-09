-- 案件7: ナレッジ検索(大規模RAG + 部署別アクセス制御)用のデータベース
--
-- ・何度実行しても壊れないように書いてある(すでにあるものは作り直さない)
-- ・案件3など、ほかのプロジェクトの表と名前が重ならないよう、表の名前に kb_ を付けている
-- ・Supabase の SQL Editor に、全部貼り付けて Run する

-- 1. ベクトル検索(pgvector)を使えるようにする
-- pgvector が入っている場所は、プロジェクトによって違う(public か extensions)。
-- どちらでも動くように、探す場所を両方指定して、型の名前には場所を付けない。
set search_path = public, extensions;
create extension if not exists vector with schema extensions;

-- 2. 表を作る -------------------------------------------------------------

-- 文書(1ファイル = 1行)
create table if not exists public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  filename text not null unique,          -- 同じファイルを二重に取り込まないための目印
  title text not null,
  department text not null
    check (department in ('戦略', '業務', 'IT', '人事', '営業', '管理')),
  client text,
  created_year text,
  confidentiality text,
  source_url text,                        -- SharePoint の URL(今回は空でよい)
  uploaded_at timestamptz not null default now()
);

-- チャンク(1つの章 = 1行)。検索の対象になる
create table if not exists public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.kb_documents (id) on delete cascade,
  section_title text,
  content text not null,
  page_start integer,
  page_end integer,
  embedding vector(1536),      -- OpenAI text-embedding-3-small の次元数
  metadata jsonb not null default '{}'::jsonb
);

-- 誰がどの部署の文書を見られるか
create table if not exists public.kb_user_departments (
  user_id uuid not null references auth.users (id) on delete cascade,
  department text not null
    check (department in ('戦略', '業務', 'IT', '人事', '営業', '管理')),
  primary key (user_id, department)
);

-- 3. 索引(検索を速くする) --------------------------------------------------
-- 課題の見本は ivfflat だったが、データが空の状態では作れず、件数が少ないと精度も出にくいので、
-- どちらでも使える hnsw にしている。
create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists kb_chunks_document_id_idx on public.kb_chunks (document_id);
create index if not exists kb_documents_department_idx on public.kb_documents (department);

-- 4. 部署別アクセス制御(RLS) ------------------------------------------------
alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;
alter table public.kb_user_departments enable row level security;

-- 自分の所属部署だけ、読める
drop policy if exists "kb_user_departments_select_own" on public.kb_user_departments;
create policy "kb_user_departments_select_own" on public.kb_user_departments
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 文書: 自分の部署のものだけ、読める
drop policy if exists "kb_documents_select_by_department" on public.kb_documents;
create policy "kb_documents_select_by_department" on public.kb_documents
  for select to authenticated
  using (
    department in (
      select ud.department from public.kb_user_departments ud
      where ud.user_id = (select auth.uid())
    )
  );

-- チャンク: 「読める文書」に属するものだけ、読める
-- (中の select は kb_documents の RLS を通るので、部署の制限がそのまま引き継がれる)
drop policy if exists "kb_chunks_select_via_documents" on public.kb_chunks;
create policy "kb_chunks_select_via_documents" on public.kb_chunks
  for select to authenticated
  using (
    exists (select 1 from public.kb_documents d where d.id = kb_chunks.document_id)
  );

-- 書き込み(insert / update / delete)の policy は、わざと作らない。
-- 文書の取り込みは、サーバー側の管理用の鍵(service_role)だけが行う。ブラウザからは書き込めない。

-- 5. 権限(匿名ユーザーには何も見せない。ログインした人にも「読む」だけ許す) ----------------
-- Supabase は、新しい表に最初から広い権限を付けるので、いったん外してから、必要な分だけ付け直す。
-- (RLS でも書き込みは止まるが、権限そのものも閉じておく「二重の鍵」にしている)
revoke all on public.kb_documents, public.kb_chunks, public.kb_user_departments from anon, authenticated;
grant select on public.kb_documents, public.kb_chunks, public.kb_user_departments to authenticated;

-- 6. 質問に近いチャンクを探す関数 ---------------------------------------------
-- security invoker(呼んだ人の権限で動く)なので、RLS がそのまま効く。
-- 人事の人が呼べば、人事の文書のチャンクしか返らない。
create or replace function public.kb_match_chunks(
  query_embedding vector(1536),
  match_count integer default 5
)
returns table (
  id uuid,
  document_id uuid,
  filename text,
  title text,
  department text,
  section_title text,
  content text,
  page_start integer,
  page_end integer,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    c.id,
    c.document_id,
    d.filename,
    d.title,
    d.department,
    c.section_title,
    c.content,
    c.page_start,
    c.page_end,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.kb_chunks c
  join public.kb_documents d on d.id = c.document_id
  where c.embedding is not null
  order by c.embedding <=> query_embedding
  limit least(match_count, 20);
$$;

revoke all on function public.kb_match_chunks(vector, integer) from public, anon;
grant execute on function public.kb_match_chunks(vector, integer) to authenticated;
-- 管理用の鍵(service_role)でも呼べるようにする(精度の測定で、全部署の文書を対象に検索するため)
grant execute on function public.kb_match_chunks(vector, integer) to service_role;


-- ============================================================
-- 監査ログ(audit.sql と同じ内容)
-- ============================================================
create table if not exists public.query_logs (
  id uuid primary key default gen_random_uuid(),
  -- ユーザーを消しても、監査ログは残す(誰かは user_id が null になっても、質問と時刻は追える)
  user_id uuid references auth.users(id) on delete set null,
  user_department text,                                   -- 質問したときの所属部署(複数なら「、」でつなぐ)
  query text not null,
  retrieved_chunk_ids uuid[] not null default '{}',       -- 参照したチャンクの ID(削除済みでも、IDは残る)
  channel text not null default 'web' check (channel in ('web', 'slack')),
  created_at timestamptz not null default now()
);

create index if not exists query_logs_user_created_idx on public.query_logs (user_id, created_at);
create index if not exists query_logs_created_idx on public.query_logs (created_at);

-- 一般のユーザーは、自分のログも含めて、読むことも書くこともできない(ログの書き換え・盗み見を防ぐ)
alter table public.query_logs enable row level security;
revoke all on public.query_logs from anon, authenticated;
-- 書き込みと確認は、サーバー側の管理用の鍵(service_role)だけ。update は「削除した文書のIDを消す」ための手順で使う
grant select, insert, update on public.query_logs to service_role;
