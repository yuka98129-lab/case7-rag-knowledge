-- 案件7: テスト用の2人を、部署に登録する
--
-- (例のメールアドレスは見本。実際に作ったテスト用ユーザーのメールアドレスに書き換えて実行する)
-- 先に Supabase の画面(Authentication → Users)で、次の2人を作っておく。
--   ・jinji-test@example.com  …… 人事部のテスト用
--   ・it-test@example.com     …… IT部のテスト用
-- (パスワードは自分で決めて、安全な場所に控える。リポジトリには書かない)
--
-- 何度実行しても壊れない。

insert into public.kb_user_departments (user_id, department)
select id, '人事' from auth.users where email = 'jinji-test@example.com'
on conflict do nothing;

insert into public.kb_user_departments (user_id, department)
select id, 'IT' from auth.users where email = 'it-test@example.com'
on conflict do nothing;

-- 結果の確認(2行出れば成功)
select u.email, d.department
from public.kb_user_departments d
join auth.users u on u.id = d.user_id
order by u.email;
