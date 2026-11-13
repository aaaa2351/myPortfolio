const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter((name) => name.endsWith('.sql')).sort();

const BOOTSTRAP = `
drop schema if exists public cascade;
drop schema if exists storage cascade;
create schema public;
grant usage on schema public to public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login password 'pw' noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
`;

async function connect(url) {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function applyMigrations(client) {
  for (const file of MIGRATIONS) await client.query(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', file), 'utf8'));
}

async function freshDatabase(url) {
  const client = await connect(url);
  await client.query(BOOTSTRAP);
  await applyMigrations(client);
  return client;
}

async function as(client, role, work) {
  await client.query(`set role ${role}`);
  try {
    return await work();
  } finally {
    await client.query('reset role');
  }
}

async function failure(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

module.exports = { connect, freshDatabase, applyMigrations, as, failure, BOOTSTRAP };
