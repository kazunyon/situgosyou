-- 表示番号とは別に、ジャンル切り替え用のカテゴリを追加します。
-- 既存のメモは「1 自然」に設定され、画面からあとで変更できます。
alter table public.memos
  add column if not exists category_number integer not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'memos_category_number_check'
      and conrelid = 'public.memos'::regclass
  ) then
    alter table public.memos
      add constraint memos_category_number_check
      check (category_number between 1 and 3);
  end if;
end $$;

create index if not exists memos_user_category_idx
  on public.memos (user_id, category_number, display_number)
  where deleted = false;
