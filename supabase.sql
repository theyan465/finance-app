-- Выполни целиком в Supabase: SQL Editor → New query → Run

create table if not exists transactions (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  amount numeric not null,
  note text default '',
  cat text,
  date date not null,
  src text default 'manual',
  deleted boolean default false,
  u bigint not null
);
create index if not exists transactions_user_u on transactions (user_id, u);
alter table transactions enable row level security;
drop policy if exists "own transactions" on transactions;
create policy "own transactions" on transactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null,
  u bigint not null
);
alter table settings enable row level security;
drop policy if exists "own settings" on settings;
create policy "own settings" on settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.transactions add column if not exists cur text, add column if not exists rates jsonb;
