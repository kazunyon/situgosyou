-- 導入する人自身のSupabaseプロジェクトのSQL Editorで実行します。
-- 作者のプロジェクトでは実行しません。新規導入用です。
begin;
create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  section varchar(20) not null default 'daily' check(section in ('daily','pc-linux')),
  display_number integer not null default 1 check(display_number between 1 and 9999),
  sort_order integer not null default 1 check(sort_order between 1 and 2147483647),
  category_number integer not null default 1 check(category_number between 1 and 9999),
  title varchar(255) not null check(length(trim(title)) > 0),
  title_color varchar(10) not null default 'black' check(title_color in ('black','red','blue','green','gray')),
  meaning varchar(2000) not null default '',
  steps jsonb not null default '[]'::jsonb check(jsonb_typeof(steps)='array' and jsonb_array_length(steps)<=10),
  marked char(1) not null default '' check(marked in ('','★')),
  deleted boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.memo_categories (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  number integer not null check(number between 1 and 9999),
  name varchar(20) not null check(length(trim(name))>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(user_id,number)
);
create table if not exists public.memo_category_versions (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  revision bigint not null default 0
);
alter table public.memos enable row level security;
alter table public.memo_categories enable row level security;
alter table public.memo_category_versions enable row level security;
-- 他の広い公開ポリシーがあるプロジェクトは、新しい専用プロジェクトで導入します。
do $$ declare t text; begin
  foreach t in array array['memos','memo_categories','memo_category_versions'] loop
    if exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname<>'kotoba_owner') then
      raise exception '既存のポリシーがあります。新しい専用プロジェクトで導入してください: %',t;
    end if;
    execute format('drop policy if exists kotoba_owner on public.%I',t);
    execute format('create policy kotoba_owner on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',t);
    execute format('revoke all on public.%I from anon',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  end loop;
end $$;
grant usage on schema public to anon,authenticated;
create index if not exists memos_owner_sort_idx on public.memos(user_id,sort_order);

-- 更新前の版が一致した場合だけ保存。別端末の変更を黙って上書きしません。
create or replace function public.kotoba_save_memo(p_memo jsonb,p_expected_updated_at timestamptz default null)
returns setof public.memos language plpgsql security invoker set search_path=public,pg_temp as $$
declare saved public.memos; begin
  if auth.uid() is null then raise exception 'ログインしてください' using errcode='42501'; end if;
  if p_expected_updated_at is null then
    begin
      insert into public.memos(id,user_id,section,display_number,sort_order,category_number,title,title_color,meaning,steps,marked,deleted,created_at,updated_at)
      values((p_memo->>'id')::uuid,auth.uid(),p_memo->>'section',(p_memo->>'display_number')::integer,(p_memo->>'sort_order')::integer,(p_memo->>'category_number')::integer,p_memo->>'title',p_memo->>'title_color',p_memo->>'meaning',p_memo->'steps',p_memo->>'marked',(p_memo->>'deleted')::boolean,coalesce((p_memo->>'created_at')::timestamptz,now()),clock_timestamp()) returning * into saved;
    exception when unique_violation then raise exception '別端末の変更があります' using errcode='40001'; end;
  else
    update public.memos set section=p_memo->>'section',display_number=(p_memo->>'display_number')::integer,sort_order=(p_memo->>'sort_order')::integer,category_number=(p_memo->>'category_number')::integer,title=p_memo->>'title',title_color=p_memo->>'title_color',meaning=p_memo->>'meaning',steps=p_memo->'steps',marked=p_memo->>'marked',deleted=(p_memo->>'deleted')::boolean,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
    where id=(p_memo->>'id')::uuid and user_id=auth.uid() and updated_at=p_expected_updated_at returning * into saved;
    if not found then raise exception '別端末の変更があります' using errcode='40001'; end if;
  end if;
  return next saved;
end $$;

create or replace function public.kotoba_save_categories(p_categories jsonb,p_expected_revision bigint)
returns bigint language plpgsql security invoker set search_path=public,pg_temp as $$
declare actual bigint; item jsonb; begin
  if auth.uid() is null then raise exception 'ログインしてください' using errcode='42501'; end if;
  if p_categories is null or jsonb_typeof(p_categories)<>'array' then raise exception 'カテゴリの形式が正しくありません'; end if;
  if jsonb_array_length(p_categories)>10 then raise exception 'カテゴリは10件までです'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'カテゴリの版が正しくありません'; end if;
  if exists(select 1 from jsonb_array_elements(p_categories) c group by c->>'number' having count(*)>1) or exists(select 1 from jsonb_array_elements(p_categories) c group by trim(c->>'name') having count(*)>1) then raise exception 'カテゴリが重複しています'; end if;
  insert into public.memo_category_versions(user_id,revision) values(auth.uid(),0) on conflict do nothing;
  select revision into actual from public.memo_category_versions where user_id=auth.uid() for update;
  if actual<>p_expected_revision then raise exception '別端末のカテゴリ変更があります' using errcode='40001'; end if;
  delete from public.memo_categories where user_id=auth.uid();
  for item in select * from jsonb_array_elements(p_categories) loop
    insert into public.memo_categories(user_id,number,name) values(auth.uid(),(item->>'number')::integer,trim(item->>'name'));
  end loop;
  update public.memo_category_versions set revision=revision+1 where user_id=auth.uid() returning revision into actual;
  return actual;
end $$;
revoke all on function public.kotoba_save_memo(jsonb,timestamptz),public.kotoba_save_categories(jsonb,bigint) from public,anon;
grant execute on function public.kotoba_save_memo(jsonb,timestamptz),public.kotoba_save_categories(jsonb,bigint) to authenticated;

do $$ declare t text; begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if;
  foreach t in array array['memos','memo_category_versions'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;

-- 匿名で実行できるのは、準備状態を返すこの関数だけ。メモは返しません。
create or replace function public.kotoba_installer_status()
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select jsonb_build_object('schemaVersion',2,
 'rls',(select count(*)=3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('memos','memo_categories','memo_category_versions') and c.relrowsecurity),
 'realtime',(select count(*)=2 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('memos','memo_category_versions')),
 'ownerPolicies',(select count(*)=3 from pg_policies where schemaname='public' and tablename in ('memos','memo_categories','memo_category_versions') and policyname='kotoba_owner'));
$$;
revoke all on function public.kotoba_installer_status() from public;
grant execute on function public.kotoba_installer_status() to anon,authenticated;
commit;
