-- 「SQL Editor」で実行してください。RLSにより、利用者は自分のメモしか読書きできません。
create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  display_number integer not null default 1 check (display_number between 1 and 9999),
  category_number integer not null default 1 check (category_number between 1 and 3),
  title varchar(255) not null,
  meaning varchar(2000) not null default '',
  marked char(1) not null default '' check (marked in ('', '★')),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 既存のテーブルにも表示番号列を追加し、初期値として1、2、3…を割り当てます。
alter table public.memos add column if not exists display_number integer;
with numbered as (
  select id, row_number() over (partition by user_id order by deleted, updated_at desc, id)::integer as value
  from public.memos
)
update public.memos as memos
set display_number = numbered.value
from numbered
where memos.id = numbered.id and memos.display_number is null;
alter table public.memos alter column display_number set default 1;
alter table public.memos alter column display_number set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memos_display_number_check' and conrelid = 'public.memos'::regclass) then
    alter table public.memos add constraint memos_display_number_check check (display_number between 1 and 9999);
  end if;
end $$;

-- カテゴリは表示番号と分けて管理し、既存のメモは「1 自然」に設定します。
alter table public.memos add column if not exists category_number integer not null default 1;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memos_category_number_check' and conrelid = 'public.memos'::regclass) then
    alter table public.memos add constraint memos_category_number_check check (category_number between 1 and 3);
  end if;
end $$;

alter table public.memos enable row level security;
create policy "利用者は自分のメモだけ読める" on public.memos for select using (auth.uid() = user_id);
create policy "利用者は自分のメモだけ作れる" on public.memos for insert with check (auth.uid() = user_id);
create policy "利用者は自分のメモだけ変更できる" on public.memos for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "利用者は自分のメモだけ削除できる" on public.memos for delete using (auth.uid() = user_id);

create index if not exists memos_user_updated_idx on public.memos (user_id, updated_at desc) where deleted = false;
create index if not exists memos_user_number_idx on public.memos (user_id, display_number, created_at) where deleted = false;
create index if not exists memos_user_category_idx on public.memos (user_id, category_number, display_number) where deleted = false;
