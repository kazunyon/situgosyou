-- 日常用メモのタイトル色を保存します。既存データは黒として扱います。
alter table public.memos
  add column if not exists title_color varchar(10) not null default 'black';

alter table public.memos drop constraint if exists memos_title_color_check;
alter table public.memos
  add constraint memos_title_color_check
  check (title_color in ('black', 'red', 'blue', 'green', 'gray'));
