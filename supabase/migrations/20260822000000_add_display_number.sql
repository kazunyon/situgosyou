-- 既存のメモへ、編集可能な表示番号を追加します。
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

create index if not exists memos_user_number_idx
  on public.memos (user_id, display_number, created_at)
  where deleted = false;
