-- 表示番号とは別に、ジャンル切り替え用のカテゴリを追加します。
-- 既存のメモは「1 自然」に設定され、画面からあとで変更できます。
alter table public.memos
  add column if not exists category_number integer not null default 1;

alter table public.memos drop constraint if exists memos_category_number_check;
alter table public.memos
  add constraint memos_category_number_check
  check (category_number between 1 and 9999);

create table if not exists public.memo_categories (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  number integer not null check (number between 1 and 9999),
  name varchar(20) not null check (char_length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, number)
);

alter table public.memo_categories enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'memo_categories' and policyname = '利用者は自分のカテゴリだけ読める') then
    create policy "利用者は自分のカテゴリだけ読める" on public.memo_categories for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'memo_categories' and policyname = '利用者は自分のカテゴリだけ作れる') then
    create policy "利用者は自分のカテゴリだけ作れる" on public.memo_categories for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'memo_categories' and policyname = '利用者は自分のカテゴリだけ変更できる') then
    create policy "利用者は自分のカテゴリだけ変更できる" on public.memo_categories for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'memo_categories' and policyname = '利用者は自分のカテゴリだけ削除できる') then
    create policy "利用者は自分のカテゴリだけ削除できる" on public.memo_categories for delete using (auth.uid() = user_id);
  end if;
end $$;

create index if not exists memos_user_category_idx
  on public.memos (user_id, category_number, display_number)
  where deleted = false;
