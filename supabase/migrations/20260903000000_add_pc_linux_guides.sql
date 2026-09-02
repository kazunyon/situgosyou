-- 既存メモは「日常用」のまま保持し、PC/Linux用の画像付き手順を追加します。
alter table public.memos add column if not exists section varchar(20) not null default 'daily';
alter table public.memos drop constraint if exists memos_section_check;
alter table public.memos add constraint memos_section_check check (section in ('daily', 'pc-linux'));

alter table public.memos add column if not exists steps jsonb not null default '[]'::jsonb;
alter table public.memos drop constraint if exists memos_steps_check;
alter table public.memos add constraint memos_steps_check
  check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 10);

create index if not exists memos_user_section_idx
  on public.memos (user_id, section, display_number)
  where deleted = false;
