let csrfToken = '';
let unauthorizedHandler = null;
const SESSION_CODES = new Set(['unauthenticated', 'session_expired', 'invalid_session']);

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || `Request failed (${status}).`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body && body.code;
    this.details = body && body.details;
  }
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

async function request(method, url, { json, form } = {}, retried = false) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }

  let response;
  try {
    response = await fetch(url, { method, headers, body, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(0, { error: 'Cannot reach the server. Check your connection and try again.', code: 'network' });
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (response.status === 403 && data && data.code === 'csrf' && !retried) {
    const session = await api.session();
    if (session.authenticated) return request(method, url, { json, form }, true);
  }
  if (response.status === 401 && data && SESSION_CODES.has(data.code) && unauthorizedHandler) unauthorizedHandler(data.code);
  if (!response.ok) throw new ApiError(response.status, data || {});
  return data;
}

const enc = encodeURIComponent;

export const api = {
  async session() {
    const data = await request('GET', '/api/auth/session');
    if (data && data.authenticated) csrfToken = data.csrfToken;
    return data;
  },
  logout: () => request('POST', '/api/auth/logout', { json: {} }),
  content: () => request('GET', '/api/admin/content'),
  save: (content, revision) => request('PUT', '/api/admin/content', { json: { content, revision } }),
  status: () => request('GET', '/api/admin/status'),
  images: () => request('GET', '/api/admin/images'),
  upload(file) {
    const form = new FormData();
    form.append('image', file);
    return request('POST', '/api/admin/images', { form });
  },
  removeImage: (id) => request('DELETE', `/api/admin/images/${enc(id)}`),
  backups: () => request('GET', '/api/admin/backups'),
  backup: (name) => request('GET', `/api/admin/backups/${enc(name)}`),
  restore: (name, revision) => request('POST', `/api/admin/backups/${enc(name)}/restore`, { json: { revision } }),
  publishing: () => request('GET', '/api/admin/publishing'),
  publish: (revision, note) => request('POST', '/api/admin/publish', { json: { revision, note } }),
  republish: (id, note) => request('POST', `/api/admin/publications/${enc(id)}/republish`, { json: { note } }),
  audit: (limit = 100) => request('GET', `/api/admin/audit?limit=${limit}`),
  deploy: {
    overview: () => request('GET', '/api/admin/deploy/overview'),
    branches: () => request('GET', '/api/admin/deploy/branches'),
    createBranch: (name, from) => request('POST', '/api/admin/deploy/branches', { json: { name, from } }),
    commits: (branch, page = 1) => request('GET', `/api/admin/deploy/commits?branch=${enc(branch)}&page=${page}`),
    deployments: (target, limit = 50) => request('GET', `/api/admin/deploy/deployments?limit=${limit}${target ? `&target=${enc(target)}` : ''}`),
    deployment: (id) => request('GET', `/api/admin/deploy/deployments/${enc(id)}`),
    verify: (id) => request('GET', `/api/admin/deploy/deployments/${enc(id)}/verify`),
    createPreview: (ref, sha) => request('POST', '/api/admin/deploy/previews', { json: { ref, sha } }),
    deployProduction: (ref, sha, confirm) => request('POST', '/api/admin/deploy/production', { json: { ref, sha, confirm } }),
    promote: (id, confirm) => request('POST', `/api/admin/deploy/deployments/${enc(id)}/promote`, { json: { confirm } }),
    rollbacks: () => request('GET', '/api/admin/deploy/rollbacks'),
    rollback: (deploymentId, confirm, reason) => request('POST', '/api/admin/deploy/rollbacks', { json: { deploymentId, confirm, reason } })
  }
};
