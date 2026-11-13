const { ApiError } = require('../errors');

function createGitHub({ config, fetchImpl = fetch }) {
  const { apiUrl, token, owner, repo } = config.github;
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  async function request(method, pathname, { query, body } = {}) {
    const url = new URL(`${apiUrl}${pathname}`);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'portfolio-cms',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(config.deploy.requestTimeoutMs)
      });
    } catch {
      throw new ApiError(502, 'github_unreachable', 'GitHub could not be reached. Try again shortly.');
    }
    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (response.ok) return data;
    if (response.status === 401) throw new ApiError(502, 'github_unauthorized', 'GitHub rejected the configured token. Check CMS_GITHUB_TOKEN.');
    if (response.status === 403 || response.status === 429) {
      if (response.headers.get('x-ratelimit-remaining') === '0' || response.status === 429) throw new ApiError(429, 'github_rate_limited', 'GitHub rate limit reached. Try again later.');
      throw new ApiError(502, 'github_forbidden', 'The GitHub token does not have permission for this action.');
    }
    if (response.status === 404) throw new ApiError(404, 'github_not_found', 'GitHub could not find that repository, branch or commit.');
    if (response.status === 409 || response.status === 422) {
      throw new ApiError(response.status === 422 ? 409 : 409, 'github_conflict', (data && data.message) || 'GitHub rejected the request.');
    }
    throw new ApiError(502, 'github_error', 'GitHub returned an unexpected error.');
  }

  const mapCommit = (item) => ({
    sha: item.sha,
    message: String((item.commit && item.commit.message) || '').split('\n')[0],
    body: String((item.commit && item.commit.message) || '').split('\n').slice(1).join('\n').trim(),
    author: (item.commit && item.commit.author && item.commit.author.name) || (item.author && item.author.login) || 'Unknown',
    date: (item.commit && item.commit.author && item.commit.author.date) || null,
    url: item.html_url || null
  });

  return {
    async getRepo() {
      const data = await request('GET', base);
      return { id: data.id, fullName: data.full_name, defaultBranch: data.default_branch, private: Boolean(data.private), url: data.html_url, canPush: Boolean(data.permissions && data.permissions.push) };
    },
    async listBranches() {
      const data = await request('GET', `${base}/branches`, { query: { per_page: 100 } });
      return data.map((branch) => ({ name: branch.name, sha: branch.commit.sha, protected: Boolean(branch.protected) }));
    },
    async getBranch(name) {
      const data = await request('GET', `${base}/branches/${name.split('/').map(encodeURIComponent).join('/')}`);
      return { name: data.name, sha: data.commit.sha, protected: Boolean(data.protected), commit: mapCommit(data.commit) };
    },
    async listCommits({ branch, page = 1, perPage = 30 }) {
      const data = await request('GET', `${base}/commits`, { query: { sha: branch, per_page: perPage, page } });
      return data.map(mapCommit);
    },
    async getCommit(sha) {
      return mapCommit(await request('GET', `${base}/commits/${encodeURIComponent(sha)}`));
    },
    async isAncestor(sha, ref) {
      const data = await request('GET', `${base}/compare/${encodeURIComponent(sha)}...${ref.split('/').map(encodeURIComponent).join('/')}`, { query: { per_page: 1 } });
      return data.status === 'identical' || data.status === 'ahead';
    },
    async createBranch(name, sha) {
      const data = await request('POST', `${base}/git/refs`, { body: { ref: `refs/heads/${name}`, sha } });
      return { name, sha: data.object.sha };
    }
  };
}

module.exports = { createGitHub };
