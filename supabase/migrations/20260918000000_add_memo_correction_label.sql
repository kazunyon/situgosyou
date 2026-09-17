-- タイトルに「訂正」表示を付けられるようにします。既存メモは訂正なしです。
alter table public.memos
  add column if not exists corrected boolean not null default false;
