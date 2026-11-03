-- Код доступа для регистрации. Выполни целиком в Supabase: SQL Editor → New query → Run.
-- Регистрация без верного кода на сервере невозможна (проверка в триггере на auth.users).

create table if not exists public.invite_codes (
  code text primary key,
  max_uses int not null default 1,
  uses int not null default 0
);
-- RLS включён и политик нет: через API таблица недоступна, читается только триггером.
alter table public.invite_codes enable row level security;

create or replace function public.check_invite_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c text := lower(trim(coalesce(new.raw_user_meta_data->>'invite_code', '')));
begin
  update public.invite_codes
     set uses = uses + 1
   where lower(code) = c and uses < max_uses;
  if not found then
    raise exception 'invalid_invite_code';
  end if;
  new.raw_user_meta_data := new.raw_user_meta_data - 'invite_code';
  return new;
end;
$$;

revoke all on function public.check_invite_code() from public, anon, authenticated;
grant execute on function public.check_invite_code() to supabase_auth_admin;

drop trigger if exists check_invite_code on auth.users;
create trigger check_invite_code
  before insert on auth.users
  for each row execute function public.check_invite_code();

-- ВАЖНО: придумай СВОЙ код и добавь его отдельным запросом (не храни его в репозитории):
-- insert into public.invite_codes (code, max_uses) values ('ТВОЙ-КОД', 3);
-- Посмотреть/сменить: select * from public.invite_codes;  delete from public.invite_codes where code = '...';
