const { createClient } = require('@supabase/supabase-js');
const { ApiError } = require('../errors');

function timeoutFetch(ms) {
  return (input, init = {}) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };
}

function createSupabaseClients(config) {
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timeoutFetch(10000) }
  };
  const client = config.supabase.url && config.supabase.serviceKey ? createClient(config.supabase.url, config.supabase.serviceKey, options) : null;
  const publicClient = config.supabase.url && config.supabase.anonKey ? createClient(config.supabase.url, config.supabase.anonKey, options) : null;
  return { client, publicClient };
}

function mapError(error) {
  const code = error && error.code;
  if (code === 'CM409') {
    const current = Number(error.details);
    return new ApiError(409, 'revision_conflict', 'The portfolio was changed somewhere else. Reload to get the latest version before continuing.', {
      currentRevision: Number.isFinite(current) ? current : null
    });
  }
  if (code === 'CM404') return new ApiError(404, 'not_found', 'The requested item does not exist.');
  if (code === 'CM422') return new ApiError(422, 'invalid_request', 'The request was rejected by the database.');
  const wrapped = new ApiError(502, 'database_error', 'The database request failed. Try again in a moment.');
  wrapped.cause = error;
  return wrapped;
}

function createSupabaseRepo({ client, publicClient }) {
  async function run(promise) {
    const { data, error } = await promise;
    if (error) throw mapError(error);
    return data;
  }

  const mapDraft = (row) => ({ content: row.content, revision: Number(row.revision), updatedAt: row.updated_at, updatedBy: row.updated_by });
  const mapBackup = (row) => ({
    name: row.name,
    createdAt: row.created_at,
    size: Number(row.size_bytes),
    reason: row.reason,
    createdBy: row.created_by,
    revision: row.revision === null ? null : Number(row.revision)
  });
  const mapPublication = (row) => ({
    id: Number(row.id),
    sourceRevision: row.source_revision === null ? null : Number(row.source_revision),
    republishedFrom: row.republished_from === null ? null : Number(row.republished_from),
    note: row.note,
    publishedAt: row.published_at,
    publishedBy: row.published_by
  });
  const mapAsset = (row) => ({
    id: row.id,
    objectPath: row.object_path,
    name: row.file_name,
    mime: row.mime_type,
    size: Number(row.size_bytes),
    url: row.public_url,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at
  });

  return {
    async getDraft() {
      const row = await run(client.from('cms_draft').select('content, revision, updated_at, updated_by').eq('id', 1).maybeSingle());
      return row ? mapDraft(row) : null;
    },

    async seedDraft(content, actor) {
      return Number(await run(client.rpc('cms_seed_draft', { p_content: content, p_actor: actor })));
    },

    async saveDraft({ content, expectedRevision, actor, reason = 'save' }) {
      const result = await run(client.rpc('cms_save_draft', { p_content: content, p_expected_revision: expectedRevision, p_actor: actor, p_reason: reason }));
      return { revision: Number(result.revision), backupName: result.backupName, updatedAt: result.updatedAt };
    },

    async listBackups(limit = 300) {
      const rows = await run(client.from('cms_backups').select('name, created_at, size_bytes, reason, created_by, revision').order('id', { ascending: false }).limit(limit));
      return rows.map(mapBackup);
    },

    async countBackups() {
      const { count, error } = await client.from('cms_backups').select('id', { count: 'exact', head: true });
      if (error) throw mapError(error);
      return count || 0;
    },

    async getBackup(name) {
      const row = await run(client.from('cms_backups').select('name, content, created_at, size_bytes, reason, created_by, revision').eq('name', name).maybeSingle());
      return row ? { ...mapBackup(row), content: row.content } : null;
    },

    async importBackup({ name, content, createdAt, actor }) {
      const { error } = await client.from('cms_backups').insert({
        name,
        content,
        reason: 'import',
        size_bytes: Buffer.byteLength(JSON.stringify(content)),
        created_at: createdAt,
        created_by: actor
      });
      if (error && error.code === '23505') return false;
      if (error) throw mapError(error);
      return true;
    },

    async publish({ expectedRevision, actor, note }) {
      const result = await run(client.rpc('cms_publish', { p_expected_revision: expectedRevision, p_actor: actor, p_note: note || null }));
      return { id: Number(result.id), sourceRevision: Number(result.sourceRevision), publishedAt: result.publishedAt };
    },

    async republish({ id, actor, note }) {
      const result = await run(client.rpc('cms_republish', { p_publication_id: id, p_actor: actor, p_note: note || null }));
      return { id: Number(result.id), sourceRevision: result.sourceRevision === null ? null : Number(result.sourceRevision), publishedAt: result.publishedAt };
    },

    async listPublications(limit = 50) {
      const rows = await run(client.from('cms_publications').select('id, source_revision, republished_from, note, published_at, published_by').order('id', { ascending: false }).limit(limit));
      return rows.map(mapPublication);
    },

    async getPublication(id) {
      const row = await run(client.from('cms_publications').select('id, content, source_revision, republished_from, note, published_at, published_by').eq('id', id).maybeSingle());
      return row ? { ...mapPublication(row), content: row.content } : null;
    },

    async getLatestPublication() {
      const row = await run(client.from('cms_publications').select('id, content, source_revision, republished_from, note, published_at, published_by').order('id', { ascending: false }).limit(1).maybeSingle());
      return row ? { ...mapPublication(row), content: row.content } : null;
    },

    async getPublished() {
      const result = await run(publicClient.rpc('cms_get_published'));
      return result ? { id: Number(result.id), content: result.content, publishedAt: result.publishedAt } : null;
    },

    async audit(entry) {
      await run(
        client.from('cms_audit_log').insert({
          actor_email: entry.actorEmail,
          actor_id: entry.actorId,
          action: entry.action,
          target: entry.target,
          outcome: entry.outcome,
          ip: entry.ip,
          user_agent: entry.userAgent,
          details: entry.details || {}
        })
      );
    },

    async listAudit(limit = 100) {
      const rows = await run(client.from('cms_audit_log').select('id, at, actor_email, action, target, outcome, ip, details').order('id', { ascending: false }).limit(limit));
      return rows.map((row) => ({
        id: Number(row.id),
        at: row.at,
        actor: row.actor_email,
        action: row.action,
        target: row.target,
        outcome: row.outcome,
        ip: row.ip,
        details: row.details || {}
      }));
    },

    async insertAsset(asset) {
      const row = await run(
        client
          .from('cms_media_assets')
          .insert({
            object_path: asset.objectPath,
            file_name: asset.name,
            mime_type: asset.mime,
            size_bytes: asset.size,
            public_url: asset.url,
            uploaded_by: asset.uploadedBy
          })
          .select('id, object_path, file_name, mime_type, size_bytes, public_url, uploaded_by, created_at')
          .single()
      );
      return mapAsset(row);
    },

    async listAssets(limit = 500) {
      const rows = await run(client.from('cms_media_assets').select('id, object_path, file_name, mime_type, size_bytes, public_url, uploaded_by, created_at').order('created_at', { ascending: false }).limit(limit));
      return rows.map(mapAsset);
    },

    async getAsset(id) {
      const row = await run(client.from('cms_media_assets').select('id, object_path, file_name, mime_type, size_bytes, public_url, uploaded_by, created_at').eq('id', id).maybeSingle());
      return row ? mapAsset(row) : null;
    },

    async deleteAsset(id) {
      await run(client.from('cms_media_assets').delete().eq('id', id));
    },

    async insertEvent(event) {
      await run(
        client.from('cms_deployment_events').insert({
          actor_email: event.actor,
          kind: event.kind,
          git_ref: event.ref || null,
          git_sha: event.sha || null,
          deployment_id: event.deploymentId || null,
          previous_deployment_id: event.previousDeploymentId || null,
          details: event.details || {}
        })
      );
    },

    async listEvents(limit = 200) {
      const rows = await run(client.from('cms_deployment_events').select('id, at, actor_email, kind, git_ref, git_sha, deployment_id, previous_deployment_id, details').order('id', { ascending: false }).limit(limit));
      return rows.map((row) => ({
        id: Number(row.id),
        at: row.at,
        actor: row.actor_email,
        kind: row.kind,
        ref: row.git_ref,
        sha: row.git_sha,
        deploymentId: row.deployment_id,
        previousDeploymentId: row.previous_deployment_id,
        details: row.details || {}
      }));
    },

    async rateLimit(key, windowSeconds, max) {
      const result = await run(client.rpc('cms_rate_limit', { p_key: key, p_window_seconds: windowSeconds, p_max: max }));
      return { allowed: Boolean(result.allowed), hits: Number(result.hits), retryAfter: Number(result.retryAfter) };
    }
  };
}

module.exports = { createSupabaseClients, createSupabaseRepo, mapError };
