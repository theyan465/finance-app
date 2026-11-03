-- Удаление собственного аккаунта (требование App Store 5.1.1(v)). Выполни в Supabase: SQL Editor -> Run.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from public.transactions where user_id = auth.uid();
  delete from public.settings where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
