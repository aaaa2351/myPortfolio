const { ApiError } = require('../errors');

function createVercel({ config, fetchImpl = fetch }) {
  const { apiUrl, token, projectId, teamId } = config.vercel;
  let projectCache = null;

  async function request(method, pathname, { query, body } = {}) {
    const url = new URL(`${apiUrl}${pathname}`);
    if (teamId) url.searchParams.set('teamId', teamId);
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(config.deploy.requestTimeoutMs)
      });
    } catch {
      throw new ApiError(502, 'vercel_unreachable', 'Vercel could not be reached. Try again shortly.');
    }
    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (response.ok) return data;
    const detail = data && data.error && data.error.message ? String(data.error.message).slice(0, 300) : '';
    if (response.status === 401 || response.status === 403) throw new ApiError(502, 'vercel_unauthorized', 'Vercel rejected the configured token or it lacks access to this project.');
    if (response.status === 404) throw new ApiError(404, 'vercel_not_found', 'Vercel could not find that project or deployment.');
    if (response.status === 429) throw new ApiError(429, 'vercel_rate_limited', 'Vercel rate limit reached. Try again later.');
    if (response.status === 409 || response.status === 422 || response.status === 400 || response.status === 410) {
      throw new ApiError(409, 'vercel_rejected', detail || 'Vercel rejected the request.');
    }
    throw new ApiError(502, 'vercel_error', 'Vercel returned an unexpected error.');
  }

  return {
    async getProject() {
      if (projectCache && projectCache.until > Date.now()) return projectCache.value;
      const data = await request('GET', `/v9/projects/${encodeURIComponent(projectId)}`);
      projectCache = { value: data, until: Date.now() + 60000 };
      return data;
    },
    async listDeployments({ target, state, limit = 50, until } = {}) {
      const data = await request('GET', '/v6/deployments', { query: { projectId, target, state, limit, until } });
      return data.deployments || [];
    },
    getDeployment(id) {
      return request('GET', `/v13/deployments/${encodeURIComponent(id)}`);
    },
    async createDeployment({ name, ref, sha, target, owner, repo, meta }) {
      const body = { name, project: projectId, gitSource: { type: 'github', org: owner, repo, ref, sha }, meta };
      if (target) body.target = target;
      return request('POST', '/v13/deployments', { query: { forceNew: 1, skipAutoDetectionConfirmation: 1 }, body });
    },
    promote(deploymentId) {
      return request('POST', `/v10/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(deploymentId)}`);
    },
    rollback(deploymentId, description) {
      return request('POST', `/v1/projects/${encodeURIComponent(projectId)}/rollback/${encodeURIComponent(deploymentId)}`, { query: { description } });
    }
  };
}

module.exports = { createVercel };
