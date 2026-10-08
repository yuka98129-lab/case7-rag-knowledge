-- 案件7: テスト用の2人を、部署に登録する
--
-- 先に Supabase の画面(Authentication → Users)で、次の2人を作っておく。
--   ・yuka98129+jinji@gmail.com  …… 人事部のテスト用
--   ・yuka98129+it@gmail.com     …… IT部のテスト用
-- (パスワードは自分で決めて、パスワード管理アプリなどに控える。この会話には書かない)
--
-- 何度実行しても壊れない。

insert into public.kb_user_departments (user_id, department)
select id, '人事' from auth.users where email = 'yuka98129+jinji@gmail.com'
on conflict do nothing;

insert into public.kb_user_departments (user_id, department)
select id, 'IT' from auth.users where email = 'yuka98129+it@gmail.com'
on conflict do nothing;

-- 結果の確認(2行出れば成功)
select u.email, d.department
from public.kb_user_departments d
join auth.users u on u.id = d.user_id
order by u.email;
