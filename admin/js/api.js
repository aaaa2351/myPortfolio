let csrfToken = '';

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || `Request failed (${status}).`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body && body.code;
    this.details = body && body.details;
  }
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
    throw new ApiError(0, { error: 'Cannot reach the local server. Check that it is still running in your terminal.', code: 'network' });
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (response.status === 403 && data && data.code === 'csrf' && !retried) {
    await api.session();
    return request(method, url, { json, form }, true);
  }
  if (!response.ok) throw new ApiError(response.status, data || {});
  return data;
}

export const api = {
  async session() {
    const data = await request('GET', '/api/session');
    csrfToken = data.csrfToken;
    return data;
  },
  content: () => request('GET', '/api/content'),
  save: (content) => request('PUT', '/api/content', { json: content }),
  status: () => request('GET', '/api/status'),
  images: () => request('GET', '/api/images'),
  upload(file) {
    const form = new FormData();
    form.append('image', file);
    return request('POST', '/api/images', { form });
  },
  backups: () => request('GET', '/api/backups'),
  backup: (name) => request('GET', `/api/backups/${encodeURIComponent(name)}`),
  restore: (name) => request('POST', `/api/backups/${encodeURIComponent(name)}/restore`)
};
