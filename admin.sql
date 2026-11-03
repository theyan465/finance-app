-- Админка: список пользователей и смена пароля. Выполни целиком в Supabase: SQL Editor → New query → Run.
-- Все функции проверяют, что вызывающий есть в таблице admins. Таблица закрыта от API (RLS без политик).

create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.admin_list_users()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, tx_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at,
           (select count(*) from public.transactions t
             where t.user_id = u.id and not coalesce(t.deleted, false))
      from auth.users u
     order by u.created_at desc;
end;
$$;

create or replace function public.admin_set_password(target uuid, new_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if length(coalesce(new_password, '')) < 6 then
    raise exception 'password_too_short';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = target;
  if not found then
    raise exception 'user_not_found';
  end if;
  -- завершить все сессии: пользователю придётся войти с новым паролем
  delete from auth.sessions where user_id = target;
end;
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;

-- Назначь администратором себя (по id пользователя, не по email):
insert into public.admins (user_id)
values ('46c58033-30eb-4a1f-9b10-e043a0b5f1b6')
on conflict do nothing;
