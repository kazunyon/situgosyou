-- 「SQL Editor」で実行してください。RLSにより、利用者は自分のメモしか読書きできません。
create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title varchar(255) not null,
  meaning varchar(2000) not null default '',
  marked char(1) not null default '' check (marked in ('', '★')),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.memos enable row level security;
create policy "利用者は自分のメモだけ読める" on public.memos for select using (auth.uid() = user_id);
create policy "利用者は自分のメモだけ作れる" on public.memos for insert with check (auth.uid() = user_id);
create policy "利用者は自分のメモだけ変更できる" on public.memos for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "利用者は自分のメモだけ削除できる" on public.memos for delete using (auth.uid() = user_id);

create index if not exists memos_user_updated_idx on public.memos (user_id, updated_at desc) where deleted = false;
