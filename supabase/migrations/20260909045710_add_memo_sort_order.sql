alter table public.memos add column if not exists sort_order integer;

with ordered as (
  select id, row_number() over (partition by user_id, section order by display_number, created_at, id)::integer as value
  from public.memos
)
update public.memos as memos
set sort_order = ordered.value
from ordered
where memos.id = ordered.id and memos.sort_order is null;

alter table public.memos alter column sort_order set default 2147483647;
alter table public.memos alter column sort_order set not null;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'memos_sort_order_check'
      and conrelid = 'public.memos'::regclass
  ) then
    alter table public.memos
      add constraint memos_sort_order_check check (sort_order between 1 and 2147483647);
  end if;
end $$;

create index if not exists memos_user_sort_idx
  on public.memos (user_id, section, sort_order, display_number)
  where deleted = false;
