begin;

create table if not exists public.cms_draft (
  id smallint primary key default 1 check (id = 1),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.cms_backups (
  id bigint generated always as identity primary key,
  name text not null unique check (name ~ '^portfolio-[0-9]{8}-[0-9]{6}-[0-9]{3}\.json$'),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  reason text not null default 'save' check (reason in ('save', 'restore', 'import')),
  revision bigint,
  size_bytes integer not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists cms_backups_recent_idx on public.cms_backups (id desc);

create table if not exists public.cms_publications (
  id bigint generated always as identity primary key,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  source_revision bigint,
  republished_from bigint references public.cms_publications (id),
  note text check (note is null or char_length(note) <= 200),
  published_at timestamptz not null default now(),
  published_by text
);
create index if not exists cms_publications_recent_idx on public.cms_publications (id desc);

create table if not exists public.cms_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_email text,
  actor_id text,
  action text not null check (char_length(action) between 1 and 80),
  target text,
  outcome text not null default 'success' check (outcome in ('success', 'failure', 'denied')),
  ip text,
  user_agent text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists cms_audit_recent_idx on public.cms_audit_log (id desc);

create table if not exists public.cms_media_assets (
  id uuid primary key default gen_random_uuid(),
  object_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  public_url text not null,
  uploaded_by text,
  created_at timestamptz not null default now()
);
create index if not exists cms_media_recent_idx on public.cms_media_assets (created_at desc);

create table if not exists public.cms_deployment_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_email text not null,
  kind text not null check (kind in ('branch_created', 'preview_deployed', 'production_deployed', 'production_promoted', 'rollback')),
  git_ref text,
  git_sha text,
  deployment_id text,
  previous_deployment_id text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists cms_deployment_events_recent_idx on public.cms_deployment_events (id desc);
create index if not exists cms_deployment_events_deployment_idx on public.cms_deployment_events (deployment_id);

create table if not exists public.cms_rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null check (hits >= 0)
);

create or replace function public.cms_forbid_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'CM403';
end;
$$;

drop trigger if exists cms_audit_append_only on public.cms_audit_log;
create trigger cms_audit_append_only
  before update or delete on public.cms_audit_log
  for each row execute function public.cms_forbid_mutation();

drop trigger if exists cms_audit_no_truncate on public.cms_audit_log;
create trigger cms_audit_no_truncate
  before truncate on public.cms_audit_log
  for each statement execute function public.cms_forbid_mutation();

drop trigger if exists cms_publications_append_only on public.cms_publications;
create trigger cms_publications_append_only
  before update or delete on public.cms_publications
  for each row execute function public.cms_forbid_mutation();

drop trigger if exists cms_publications_no_truncate on public.cms_publications;
create trigger cms_publications_no_truncate
  before truncate on public.cms_publications
  for each statement execute function public.cms_forbid_mutation();

drop trigger if exists cms_events_append_only on public.cms_deployment_events;
create trigger cms_events_append_only
  before update or delete on public.cms_deployment_events
  for each row execute function public.cms_forbid_mutation();

create or replace function public.cms_seed_draft(p_content jsonb, p_actor text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision bigint;
begin
  if jsonb_typeof(p_content) is distinct from 'object' then
    raise exception 'content must be a JSON object' using errcode = 'CM422';
  end if;
  insert into public.cms_draft (id, content, revision, updated_by)
  values (1, p_content, 1, p_actor)
  on conflict (id) do nothing;
  select d.revision into v_revision from public.cms_draft d where d.id = 1;
  return v_revision;
end;
$$;

create or replace function public.cms_save_draft(p_content jsonb, p_expected_revision bigint, p_actor text, p_reason text default 'save')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.cms_draft%rowtype;
  v_name text;
  v_time timestamptz;
  v_attempt integer := 0;
  v_saved_at timestamptz := now();
begin
  if jsonb_typeof(p_content) is distinct from 'object' then
    raise exception 'content must be a JSON object' using errcode = 'CM422';
  end if;
  if p_reason is null or p_reason not in ('save', 'restore') then
    raise exception 'invalid reason' using errcode = 'CM422';
  end if;

  select * into v_row from public.cms_draft where id = 1 for update;
  if not found then
    raise exception 'draft does not exist' using errcode = 'CM404';
  end if;
  if p_expected_revision is null or v_row.revision <> p_expected_revision then
    raise exception 'revision_conflict' using errcode = 'CM409', detail = v_row.revision::text;
  end if;

  v_time := clock_timestamp();
  loop
    v_name := 'portfolio-' || to_char(v_time at time zone 'UTC', 'YYYYMMDD"-"HH24MISS"-"MS') || '.json';
    exit when not exists (select 1 from public.cms_backups b where b.name = v_name);
    v_time := v_time + interval '1 millisecond';
    v_attempt := v_attempt + 1;
    if v_attempt > 50 then
      raise exception 'could not allocate a backup name' using errcode = 'CM500';
    end if;
  end loop;

  insert into public.cms_backups (name, content, reason, revision, size_bytes, created_at, created_by)
  values (v_name, v_row.content, p_reason, v_row.revision, octet_length(v_row.content::text), v_time, p_actor);

  update public.cms_draft
  set content = p_content, revision = v_row.revision + 1, updated_at = v_saved_at, updated_by = p_actor
  where id = 1;

  return jsonb_build_object('revision', v_row.revision + 1, 'backupName', v_name, 'updatedAt', v_saved_at);
end;
$$;

create or replace function public.cms_publish(p_expected_revision bigint, p_actor text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.cms_draft%rowtype;
  v_id bigint;
  v_at timestamptz;
begin
  perform pg_advisory_xact_lock(7001);
  select * into v_row from public.cms_draft where id = 1 for share;
  if not found then
    raise exception 'draft does not exist' using errcode = 'CM404';
  end if;
  if p_expected_revision is null or v_row.revision <> p_expected_revision then
    raise exception 'revision_conflict' using errcode = 'CM409', detail = v_row.revision::text;
  end if;
  insert into public.cms_publications (content, source_revision, note, published_by)
  values (v_row.content, v_row.revision, p_note, p_actor)
  returning id, published_at into v_id, v_at;
  return jsonb_build_object('id', v_id, 'sourceRevision', v_row.revision, 'publishedAt', v_at);
end;
$$;

create or replace function public.cms_republish(p_publication_id bigint, p_actor text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.cms_publications%rowtype;
  v_id bigint;
  v_at timestamptz;
begin
  perform pg_advisory_xact_lock(7001);
  select * into v_source from public.cms_publications p where p.id = p_publication_id;
  if not found then
    raise exception 'publication does not exist' using errcode = 'CM404';
  end if;
  insert into public.cms_publications (content, source_revision, republished_from, note, published_by)
  values (v_source.content, v_source.source_revision, v_source.id, p_note, p_actor)
  returning id, published_at into v_id, v_at;
  return jsonb_build_object('id', v_id, 'sourceRevision', v_source.source_revision, 'publishedAt', v_at);
end;
$$;

create or replace function public.cms_get_published()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('id', p.id, 'content', p.content, 'publishedAt', p.published_at)
  from public.cms_publications p
  order by p.id desc
  limit 1;
$$;

create or replace function public.cms_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_hits integer;
  v_start timestamptz;
  v_retry integer;
begin
  if p_key is null or p_window_seconds < 1 or p_max < 1 then
    raise exception 'invalid rate limit parameters' using errcode = 'CM422';
  end if;
  insert into public.cms_rate_limits as r (key, window_start, hits)
  values (p_key, v_now, 1)
  on conflict (key) do update set
    hits = case when r.window_start + make_interval(secs => p_window_seconds) <= v_now then 1 else r.hits + 1 end,
    window_start = case when r.window_start + make_interval(secs => p_window_seconds) <= v_now then v_now else r.window_start end
  returning r.hits, r.window_start into v_hits, v_start;
  if random() < 0.02 then
    delete from public.cms_rate_limits where window_start < v_now - interval '1 day';
  end if;
  v_retry := greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - v_now)))::integer);
  return jsonb_build_object('allowed', v_hits <= p_max, 'hits', v_hits, 'retryAfter', v_retry);
end;
$$;

alter table public.cms_draft enable row level security;
alter table public.cms_backups enable row level security;
alter table public.cms_publications enable row level security;
alter table public.cms_audit_log enable row level security;
alter table public.cms_media_assets enable row level security;
alter table public.cms_deployment_events enable row level security;
alter table public.cms_rate_limits enable row level security;

revoke all on table
  public.cms_draft,
  public.cms_backups,
  public.cms_publications,
  public.cms_audit_log,
  public.cms_media_assets,
  public.cms_deployment_events,
  public.cms_rate_limits
from public, anon, authenticated;

grant select on public.cms_draft to service_role;
grant select, insert on public.cms_backups to service_role;
grant select on public.cms_publications to service_role;
grant select, insert on public.cms_audit_log to service_role;
grant select, insert, delete on public.cms_media_assets to service_role;
grant select, insert on public.cms_deployment_events to service_role;

revoke all on function public.cms_forbid_mutation() from public, anon, authenticated;
revoke all on function public.cms_seed_draft(jsonb, text) from public, anon, authenticated;
revoke all on function public.cms_save_draft(jsonb, bigint, text, text) from public, anon, authenticated;
revoke all on function public.cms_publish(bigint, text, text) from public, anon, authenticated;
revoke all on function public.cms_republish(bigint, text, text) from public, anon, authenticated;
revoke all on function public.cms_get_published() from public, anon, authenticated;
revoke all on function public.cms_rate_limit(text, integer, integer) from public, anon, authenticated;

grant execute on function public.cms_seed_draft(jsonb, text) to service_role;
grant execute on function public.cms_save_draft(jsonb, bigint, text, text) to service_role;
grant execute on function public.cms_publish(bigint, text, text) to service_role;
grant execute on function public.cms_republish(bigint, text, text) to service_role;
grant execute on function public.cms_rate_limit(text, integer, integer) to service_role;
grant execute on function public.cms_get_published() to anon, authenticated, service_role;

commit;
