const test = require('node:test');
const assert = require('node:assert/strict');
const { connect, freshDatabase, applyMigrations, as, failure } = require('./support');

const URL = process.env.TEST_DATABASE_URL;
const skip = URL ? false : 'Set TEST_DATABASE_URL to a disposable PostgreSQL database to run the migration tests.';
const TABLES = ['cms_draft', 'cms_backups', 'cms_publications', 'cms_audit_log', 'cms_media_assets', 'cms_deployment_events', 'cms_rate_limits'];
const content = (title) => ({ schemaVersion: 1, hero: { title } });

test('migrations apply cleanly and can be re-applied', { skip }, async () => {
  const client = await freshDatabase(URL);
  try {
    await applyMigrations(client);
    const tables = (await client.query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((row) => row.tablename);
    for (const table of TABLES) assert.ok(tables.includes(table), table);
    const rls = (await client.query("select relname, relrowsecurity from pg_class where relname like 'cms\\_%' and relkind = 'r'")).rows;
    assert.equal(rls.length, TABLES.length);
    assert.ok(rls.every((row) => row.relrowsecurity), 'row level security is on for every table');
    const bucket = (await client.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'portfolio-images'")).rows[0];
    assert.equal(bucket.public, true);
    assert.equal(Number(bucket.file_size_limit), 5242880);
    assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp']);
  } finally {
    await client.end();
  }
});

test('anonymous and signed-in Supabase users cannot read, write or call anything private', { skip }, async () => {
  const client = await freshDatabase(URL);
  try {
    await client.query("select public.cms_seed_draft('{\"a\":1}'::jsonb, 'seed')");
    for (const role of ['anon', 'authenticated']) {
      for (const table of TABLES) {
        const error = await as(client, role, () => failure(client.query(`select * from public.${table}`)));
        assert.equal(error && error.code, '42501', `${role} read ${table}`);
        const writeError = await as(client, role, () => failure(client.query(`delete from public.${table}`)));
        assert.equal(writeError && writeError.code, '42501', `${role} delete ${table}`);
      }
      const calls = [
        "select public.cms_seed_draft('{}'::jsonb, 'x')",
        "select public.cms_save_draft('{}'::jsonb, 1, 'x', 'save')",
        "select public.cms_publish(1, 'x', null)",
        "select public.cms_republish(1, 'x', null)",
        "select public.cms_rate_limit('k', 60, 5)"
      ];
      for (const sql of calls) {
        const error = await as(client, role, () => failure(client.query(sql)));
        assert.equal(error && error.code, '42501', `${role} ran ${sql}`);
      }
      const published = await as(client, role, () => client.query('select public.cms_get_published() as value'));
      assert.equal(published.rows[0].value, null);
    }
  } finally {
    await client.end();
  }
});

test('the audit log, publications and deployment events are append-only even for the owner', { skip }, async () => {
  const client = await freshDatabase(URL);
  try {
    await client.query("select public.cms_seed_draft('{\"a\":1}'::jsonb, 'seed')");
    await client.query("select public.cms_publish(1, 'me', 'first')");
    await client.query("insert into public.cms_audit_log (action) values ('x')");
    await client.query("insert into public.cms_deployment_events (actor_email, kind) values ('me', 'rollback')");
    for (const sql of ['update public.cms_audit_log set action = $$y$$', 'delete from public.cms_audit_log', 'truncate public.cms_audit_log', 'update public.cms_publications set note = $$y$$', 'delete from public.cms_publications', 'truncate public.cms_publications', 'update public.cms_deployment_events set kind = $$branch_created$$', 'delete from public.cms_deployment_events']) {
      const error = await failure(client.query(sql));
      assert.equal(error && error.code, 'CM403', sql);
    }
    const asService = await as(client, 'service_role', async () => ({
      update: await failure(client.query('update public.cms_audit_log set action = $$y$$')),
      insert: await failure(client.query("insert into public.cms_audit_log (action) values ('ok')")),
      draftWrite: await failure(client.query("update public.cms_draft set revision = 99"))
    }));
    assert.equal(asService.update.code, '42501');
    assert.equal(asService.insert, null);
    assert.equal(asService.draftWrite.code, '42501');
  } finally {
    await client.end();
  }
});

test('saving is atomic: it backs up the old draft, bumps the revision and rejects stale writers', { skip }, async () => {
  const client = await freshDatabase(URL);
  try {
    await client.query("select public.cms_seed_draft($1::jsonb, 'seed')", [JSON.stringify(content('v1'))]);
    await client.query("select public.cms_seed_draft($1::jsonb, 'again')", [JSON.stringify(content('ignored'))]);
    assert.equal((await client.query('select revision, content from public.cms_draft')).rows[0].content.hero.title, 'v1');

    const saved = (await as(client, 'service_role', () => client.query("select public.cms_save_draft($1::jsonb, 1, 'me@example.com', 'save') as r", [JSON.stringify(content('v2'))]))).rows[0].r;
    assert.equal(saved.revision, 2);
    assert.match(saved.backupName, /^portfolio-\d{8}-\d{6}-\d{3}\.json$/);
    const backup = (await client.query('select * from public.cms_backups')).rows[0];
    assert.equal(backup.name, saved.backupName);
    assert.equal(backup.content.hero.title, 'v1');
    assert.equal(backup.revision, '1');
    assert.equal(backup.created_by, 'me@example.com');
    assert.equal(backup.reason, 'save');
    assert.ok(backup.size_bytes > 0);

    const stale = await as(client, 'service_role', () => failure(client.query("select public.cms_save_draft($1::jsonb, 1, 'x', 'save')", [JSON.stringify(content('lost'))])));
    assert.equal(stale.code, 'CM409');
    assert.equal(stale.detail, '2');
    assert.equal((await client.query('select count(*)::int as n from public.cms_backups')).rows[0].n, 1);
    assert.equal((await client.query('select content from public.cms_draft')).rows[0].content.hero.title, 'v2');

    const nullRevision = await failure(client.query("select public.cms_save_draft('{}'::jsonb, null, 'x', 'save')"));
    assert.equal(nullRevision.code, 'CM409');
    const notObject = await failure(client.query("select public.cms_save_draft('[]'::jsonb, 2, 'x', 'save')"));
    assert.equal(notObject.code, 'CM422');
    const badReason = await failure(client.query("select public.cms_save_draft('{}'::jsonb, 2, 'x', 'nuke')"));
    assert.equal(badReason.code, 'CM422');
    const restored = (await client.query("select public.cms_save_draft($1::jsonb, 2, 'me', 'restore') as r", [JSON.stringify(content('v1'))])).rows[0].r;
    assert.equal(restored.revision, 3);
    assert.equal((await client.query("select reason from public.cms_backups order by id desc limit 1")).rows[0].reason, 'restore');
  } finally {
    await client.end();
  }
});

test('saving without a draft fails cleanly, and rapid saves always get distinct backup names', { skip }, async () => {
  const client = await freshDatabase(URL);
  try {
    const missing = await failure(client.query("select public.cms_save_draft('{}'::jsonb, 1, 'x', 'save')"));
    assert.equal(missing.code, 'CM404');
    await client.query("select public.cms_seed_draft('{\"n\":0}'::jsonb, 'seed')");
    for (let revision = 1; revision <= 8; revision += 1) {
      await client.query("select public.cms_save_draft($1::jsonb, $2, 'me', 'save')", [JSON.stringify({ n: revision }), revision]);
    }
    const names = (await client.query('select name from public.cms_backups')).rows.map((row) => row.name);
    assert.equal(names.length, 8);
    assert.equal(new Set(names).size, 8);
  } finally {
    await client.end();
  }
});

test('two simultaneous saves based on the same revision: exactly one wins', { skip }, async () => {
  const setup = await freshDatabase(URL);
  const a = await connect(URL);
  const b = await connect(URL);
  try {
    await setup.query("select public.cms_seed_draft('{\"n\":0}'::jsonb, 'seed')");
    const results = await Promise.allSettled([
      a.query("select public.cms_save_draft('{\"n\":\"a\"}'::jsonb, 1, 'a', 'save')"),
      b.query("select public.cms_save_draft('{\"n\":\"b\"}'::jsonb, 1, 'b', 'save')")
    ]);
    const won = results.filter((result) => result.status === 'fulfilled');
    const lost = results.filter((result) => result.status === 'rejected');
    assert.equal(won.length, 1);
    assert.equal(lost.length, 1);
    assert.equal(lost[0].reason.code, 'CM409');
    const row = (await setup.query('select revision, content from public.cms_draft')).rows[0];
    assert.equal(row.revision, '2');
    assert.equal((await setup.query('select count(*)::int as n from public.cms_backups')).rows[0].n, 1);
    assert.ok(['a', 'b'].includes(row.content.n));
  } finally {
    await Promise.all([setup.end(), a.end(), b.end()]);
  }
});

test('publishing copies exactly the reviewed draft, keeps history and serves only the latest to the public', { skip }, async () => {
  const client = await freshDatabase(URL);
  try {
    await client.query("select public.cms_seed_draft($1::jsonb, 'seed')", [JSON.stringify(content('one'))]);
    const first = (await client.query("select public.cms_publish(1, 'me', 'first release') as r")).rows[0].r;
    assert.equal(first.sourceRevision, 1);
    await client.query("select public.cms_save_draft($1::jsonb, 1, 'me', 'save')", [JSON.stringify(content('two'))]);

    const stale = await failure(client.query("select public.cms_publish(1, 'me', null)"));
    assert.equal(stale.code, 'CM409');
    const publicView = await as(client, 'anon', () => client.query('select public.cms_get_published() as value'));
    assert.equal(publicView.rows[0].value.content.hero.title, 'one');
    assert.equal(publicView.rows[0].value.id, first.id);

    const second = (await client.query("select public.cms_publish(2, 'me', null) as r")).rows[0].r;
    assert.ok(second.id > first.id);
    assert.equal((await as(client, 'authenticated', () => client.query('select public.cms_get_published() as value'))).rows[0].value.content.hero.title, 'two');

    const again = (await client.query("select public.cms_republish($1, 'me', 'back to one') as r", [first.id])).rows[0].r;
    assert.ok(again.id > second.id);
    assert.equal((await client.query('select public.cms_get_published() as value')).rows[0].value.content.hero.title, 'one');
    const rows = (await client.query('select id, republished_from, note, published_by from public.cms_publications order by id')).rows;
    assert.equal(rows.length, 3);
    assert.equal(rows[2].republished_from, String(first.id));
    assert.equal((await client.query('select content from public.cms_draft')).rows[0].content.hero.title, 'two');
    const missing = await failure(client.query("select public.cms_republish(9999, 'me', null)"));
    assert.equal(missing.code, 'CM404');
    const longNote = await failure(client.query("select public.cms_publish(2, 'me', $1)", ['x'.repeat(201)]));
    assert.equal(longNote.code, '23514');
  } finally {
    await client.end();
  }
});

test('the rate limit function counts per window, blocks past the maximum and resets', { skip }, async () => {
  const client = await freshDatabase(URL);
  try {
    const hit = async (key) => (await client.query("select public.cms_rate_limit($1, 1, 3) as r", [key])).rows[0].r;
    assert.equal((await hit('a')).allowed, true);
    assert.equal((await hit('a')).allowed, true);
    const third = await hit('a');
    assert.equal(third.allowed, true);
    assert.equal(third.hits, 3);
    const fourth = await hit('a');
    assert.equal(fourth.allowed, false);
    assert.ok(fourth.retryAfter >= 1 && fourth.retryAfter <= 1);
    assert.equal((await hit('other')).allowed, true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const reset = await hit('a');
    assert.equal(reset.allowed, true);
    assert.equal(reset.hits, 1);
    const bad = await failure(client.query("select public.cms_rate_limit('k', 0, 3)"));
    assert.equal(bad.code, 'CM422');
  } finally {
    await client.end();
  }
});

test('table constraints reject bad data at the database level', { skip }, async () => {
  const client = await freshDatabase(URL);
  try {
    const asset = (mime, size, name = 'a.png') => client.query("insert into public.cms_media_assets (object_path, file_name, mime_type, size_bytes, public_url) values ($1, $2, $3, $4, 'https://x')", [`uploads/${name}${Math.random()}`, name, mime, size]);
    assert.equal(await failure(asset('image/png', 1000)), null);
    assert.equal((await failure(asset('image/svg+xml', 1000))).code, '23514');
    assert.equal((await failure(asset('image/png', 0))).code, '23514');
    assert.equal((await failure(asset('image/png', 6 * 1024 * 1024))).code, '23514');
    assert.equal((await failure(client.query("insert into public.cms_draft (id, content) values (2, '{}')"))).code, '23514');
    assert.equal((await failure(client.query("insert into public.cms_draft (id, content) values (1, '[]')"))).code, '23514');
    assert.equal((await failure(client.query("insert into public.cms_backups (name, content, size_bytes) values ('evil.json', '{}', 1)"))).code, '23514');
    assert.equal((await failure(client.query("insert into public.cms_audit_log (action, outcome) values ('x', 'maybe')"))).code, '23514');
    assert.equal((await failure(client.query("insert into public.cms_deployment_events (actor_email, kind) values ('x', 'format_disk')"))).code, '23514');
  } finally {
    await client.end();
  }
});
