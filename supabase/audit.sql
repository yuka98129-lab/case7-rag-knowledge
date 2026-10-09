-- 監査ログ(誰が・いつ・何を質問して・どのチャンクが参照されたか)
-- 何度実行しても壊れない。schema.sql にも同じ内容が入っている。
set search_path = public, extensions;

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
