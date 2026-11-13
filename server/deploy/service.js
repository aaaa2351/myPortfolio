const { ApiError } = require('../errors');
const { missingSettings } = require('../config');

const SHA_RE = /^[0-9a-f]{40}$/;
const DEPLOYMENT_ID_RE = /^dpl_[A-Za-z0-9]{6,64}$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,98}$/;
const ACTIVE_STATES = new Set(['QUEUED', 'INITIALIZING', 'BUILDING']);

function isValidBranchName(name) {
  if (typeof name !== 'string' || !BRANCH_RE.test(name)) return false;
  if (name.includes('..') || name.includes('//') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false;
  return !name.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock') || part === '');
}

function iso(value) {
  if (value === undefined || value === null) return null;
  const date = new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalize(deployment) {
  const meta = deployment.meta || {};
  const source = deployment.gitSource || {};
  const sha = meta.githubCommitSha || source.sha || null;
  const url = deployment.url ? `https://${String(deployment.url).replace(/^https?:\/\//, '')}` : null;
  const aliases = Array.isArray(deployment.alias) ? deployment.alias : Array.isArray(deployment.aliases) ? deployment.aliases : [];
  const created = deployment.createdAt || deployment.created;
  const ready = deployment.ready || deployment.readyAt || null;
  return {
    id: deployment.uid || deployment.id,
    url,
    state: String(deployment.readyState || deployment.state || 'UNKNOWN').toUpperCase(),
    substate: deployment.readySubstate ? String(deployment.readySubstate).toUpperCase() : null,
    target: deployment.target || 'preview',
    createdAt: iso(created),
    readyAt: iso(ready),
    durationMs: ready && created ? Math.max(0, Number(ready) - Number(created)) : null,
    branch: meta.githubCommitRef || source.ref || null,
    sha,
    shortSha: sha ? sha.slice(0, 7) : null,
    message: meta.githubCommitMessage ? String(meta.githubCommitMessage).split('\n')[0] : null,
    author: meta.githubCommitAuthorName || meta.githubCommitAuthorLogin || null,
    creator: (deployment.creator && (deployment.creator.username || deployment.creator.email)) || null,
    inspectorUrl: deployment.inspectorUrl || null,
    aliases,
    errorMessage: deployment.errorMessage || (deployment.errorCode ? String(deployment.errorCode) : null)
  };
}

function confirmationFor(deployment) {
  return deployment.shortSha || String(deployment.id).slice(-7);
}

function createDeployService({ config, github, vercel, repo, fetchImpl = fetch }) {
  const problems = missingSettings(config);

  function needGithub() {
    if (problems.github.length) throw new ApiError(503, 'not_configured', 'GitHub is not configured.', { service: 'github', missing: problems.github });
  }

  function needVercel() {
    if (problems.vercel.length) throw new ApiError(503, 'not_configured', 'Vercel is not configured.', { service: 'vercel', missing: problems.vercel });
  }

  function needBoth() {
    needGithub();
    needVercel();
  }

  function requireBranch(name) {
    if (!isValidBranchName(name)) throw new ApiError(400, 'bad_branch', 'That is not a valid branch name.');
    return name;
  }

  function requireSha(sha) {
    if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw new ApiError(400, 'bad_sha', 'A full 40-character commit SHA is required.');
    return sha;
  }

  function requireDeploymentId(id) {
    if (typeof id !== 'string' || !DEPLOYMENT_ID_RE.test(id)) throw new ApiError(400, 'bad_deployment', 'That is not a valid deployment id.');
    return id;
  }

  async function record(event) {
    try {
      await repo.insertEvent(event);
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', msg: 'deployment_event_failed', kind: event.kind, error: error.message }));
    }
  }

  async function confirmedCommit(ref, sha) {
    requireBranch(ref);
    requireSha(sha);
    const commit = await github.getCommit(sha);
    if (!(await github.isAncestor(sha, ref))) {
      throw new ApiError(422, 'commit_not_on_branch', `That commit is not part of ${ref}.`);
    }
    return commit;
  }

  async function currentProduction(project, productionList) {
    const pointer = project && project.targets && project.targets.production;
    if (pointer && (pointer.id || pointer.uid)) {
      const id = pointer.id || pointer.uid;
      const match = productionList.find((item) => item.id === id);
      if (match) return match;
      try {
        return normalize(await vercel.getDeployment(id));
      } catch {
        return normalize(pointer);
      }
    }
    return productionList.find((item) => item.state === 'READY' && item.substate !== 'STAGED') || null;
  }

  async function overview() {
    const result = { configured: { github: !problems.github.length, vercel: !problems.vercel.length }, missing: { github: problems.github, vercel: problems.vercel }, productionBranch: config.github.productionBranch, requirePreviewBeforeProduction: config.deploy.requirePreviewBeforeProduction };
    const [repoInfo, project, production, recent] = await Promise.allSettled([
      problems.github.length ? Promise.reject(new Error('unconfigured')) : github.getRepo(),
      problems.vercel.length ? Promise.reject(new Error('unconfigured')) : vercel.getProject(),
      problems.vercel.length ? Promise.reject(new Error('unconfigured')) : vercel.listDeployments({ target: 'production', limit: 30 }),
      problems.vercel.length ? Promise.reject(new Error('unconfigured')) : vercel.listDeployments({ limit: 8 })
    ]);
    const failure = (settled) => (settled.status === 'rejected' && settled.reason.message !== 'unconfigured' ? settled.reason.message : null);

    result.github = repoInfo.status === 'fulfilled' ? { connected: true, ...repoInfo.value } : { connected: false, error: failure(repoInfo) };
    result.vercel = project.status === 'fulfilled' ? { connected: true, id: project.value.id, name: project.value.name, framework: project.value.framework || null } : { connected: false, error: failure(project) };

    const productionList = production.status === 'fulfilled' ? production.value.map(normalize) : [];
    result.production = project.status === 'fulfilled' ? await currentProduction(project.value, productionList) : null;
    result.latestSuccessful = productionList.find((item) => item.state === 'READY') || null;
    result.recent = recent.status === 'fulfilled' ? recent.value.map(normalize) : [];
    result.inProgress = productionList.filter((item) => ACTIVE_STATES.has(item.state));
    return result;
  }

  async function branches() {
    needGithub();
    const list = await github.listBranches();
    let deployments = [];
    if (!problems.vercel.length) {
      try {
        deployments = (await vercel.listDeployments({ limit: 100 })).map(normalize);
      } catch {
        deployments = [];
      }
    }
    return list.map((branch) => {
      const match = deployments.find((item) => item.sha === branch.sha);
      return { ...branch, isProduction: branch.name === config.github.productionBranch, deployment: match ? { id: match.id, state: match.state, target: match.target, url: match.url } : null };
    });
  }

  async function commits(branch, page) {
    needGithub();
    requireBranch(branch);
    const list = await github.listCommits({ branch, page: Math.min(20, Math.max(1, page || 1)) });
    let deployments = [];
    if (!problems.vercel.length) {
      try {
        deployments = (await vercel.listDeployments({ limit: 100 })).map(normalize);
      } catch {
        deployments = [];
      }
    }
    return list.map((commit) => ({
      ...commit,
      shortSha: commit.sha.slice(0, 7),
      deployments: deployments.filter((item) => item.sha === commit.sha).map((item) => ({ id: item.id, state: item.state, target: item.target, url: item.url, createdAt: item.createdAt }))
    }));
  }

  async function createBranch({ name, from }, actor) {
    needGithub();
    let branchName = typeof name === 'string' ? name.trim() : '';
    if (branchName && !branchName.startsWith(config.deploy.branchPrefix)) branchName = `${config.deploy.branchPrefix}${branchName}`;
    if (!isValidBranchName(branchName) || branchName === config.deploy.branchPrefix) {
      throw new ApiError(400, 'bad_branch', 'Use letters, numbers, dots, dashes, underscores and slashes for the branch name.');
    }
    if (branchName === config.github.productionBranch) throw new ApiError(403, 'production_protected', 'The production branch cannot be created or changed here.');
    const source = typeof from === 'string' ? from.trim() : '';
    let sha = source;
    if (!SHA_RE.test(source)) {
      requireBranch(source);
      sha = (await github.getBranch(source)).sha;
    } else {
      await github.getCommit(source);
    }
    const created = await github.createBranch(branchName, sha);
    await record({ actor: actor.email, kind: 'branch_created', ref: created.name, sha: created.sha, details: { from: source } });
    return created;
  }

  async function listDeployments({ target, limit }) {
    needVercel();
    const safeTarget = target === 'production' || target === 'preview' ? target : undefined;
    const list = (await vercel.listDeployments({ target: safeTarget === 'production' ? 'production' : undefined, limit: Math.min(100, Math.max(1, Number(limit) || 40)) })).map(normalize);
    const events = await repo.listEvents(200).catch(() => []);
    const byDeployment = new Map();
    for (const event of events) if (event.deploymentId && !byDeployment.has(event.deploymentId)) byDeployment.set(event.deploymentId, event);
    return list
      .filter((item) => (safeTarget === 'preview' ? item.target !== 'production' : true))
      .map((item) => ({ ...item, triggeredBy: byDeployment.has(item.id) ? byDeployment.get(item.id).actor : null, triggeredKind: byDeployment.has(item.id) ? byDeployment.get(item.id).kind : null }));
  }

  async function getDeployment(id) {
    needVercel();
    return normalize(await vercel.getDeployment(requireDeploymentId(id)));
  }

  async function createPreview({ ref, sha }, actor) {
    needBoth();
    requireBranch(ref);
    let target = sha;
    if (!target) target = (await github.getBranch(ref)).sha;
    await confirmedCommit(ref, target);
    const project = await vercel.getProject();
    const created = normalize(
      await vercel.createDeployment({ name: project.name, ref, sha: target, owner: config.github.owner, repo: config.github.repo, meta: { cmsTriggeredBy: actor.email } })
    );
    await record({ actor: actor.email, kind: 'preview_deployed', ref, sha: target, deploymentId: created.id });
    return created;
  }

  async function deployProduction({ ref, sha, confirm }, actor) {
    needBoth();
    requireBranch(ref);
    requireSha(sha);
    if (confirm !== sha.slice(0, 7)) throw new ApiError(400, 'confirmation_mismatch', `Type ${sha.slice(0, 7)} to confirm this production deployment.`);
    const commit = await confirmedCommit(ref, sha);

    const active = (await vercel.listDeployments({ target: 'production', limit: 10 })).map(normalize).filter((item) => ACTIVE_STATES.has(item.state));
    if (active.length) throw new ApiError(409, 'deployment_in_progress', 'A production deployment is already running. Wait for it to finish.');

    if (config.deploy.requirePreviewBeforeProduction) {
      const known = (await vercel.listDeployments({ limit: 100 })).map(normalize);
      if (!known.some((item) => item.sha === sha && item.state === 'READY')) {
        throw new ApiError(412, 'preview_required', 'Deploy and inspect a preview of this exact commit before sending it to production.');
      }
    }

    const project = await vercel.getProject();
    const created = normalize(
      await vercel.createDeployment({ name: project.name, ref, sha, target: 'production', owner: config.github.owner, repo: config.github.repo, meta: { cmsTriggeredBy: actor.email } })
    );
    await record({ actor: actor.email, kind: 'production_deployed', ref, sha, deploymentId: created.id, details: { message: commit.message } });
    return created;
  }

  async function promote(id, confirm, actor) {
    needVercel();
    requireDeploymentId(id);
    const deployment = normalize(await vercel.getDeployment(id));
    if (deployment.target !== 'production' || deployment.state !== 'READY') throw new ApiError(409, 'not_promotable', 'Only a finished production deployment can be promoted.');
    if (confirm !== confirmationFor(deployment)) throw new ApiError(400, 'confirmation_mismatch', `Type ${confirmationFor(deployment)} to confirm.`);
    await vercel.promote(id);
    await record({ actor: actor.email, kind: 'production_promoted', sha: deployment.sha, deploymentId: id });
    return normalize(await vercel.getDeployment(id));
  }

  async function rollbackCandidates() {
    needVercel();
    const [project, list] = await Promise.all([vercel.getProject(), vercel.listDeployments({ target: 'production', state: 'READY', limit: 50 })]);
    const normalized = list.map(normalize);
    const current = await currentProduction(project, normalized);
    return {
      current,
      candidates: normalized.filter((item) => item.state === 'READY' && item.substate !== 'STAGED' && (!current || item.id !== current.id)).map((item) => ({ ...item, confirmation: confirmationFor(item) }))
    };
  }

  async function rollback({ deploymentId, confirm, reason }, actor) {
    needVercel();
    requireDeploymentId(deploymentId);
    const target = normalize(await vercel.getDeployment(deploymentId));
    if (target.target !== 'production' || target.state !== 'READY' || target.substate === 'STAGED') {
      throw new ApiError(409, 'not_rollbackable', 'Only a previous production deployment that served traffic can be restored.');
    }
    if (confirm !== confirmationFor(target)) throw new ApiError(400, 'confirmation_mismatch', `Type ${confirmationFor(target)} to confirm this rollback.`);
    const project = await vercel.getProject();
    const production = (await vercel.listDeployments({ target: 'production', state: 'READY', limit: 30 })).map(normalize);
    const current = await currentProduction(project, production);
    if (current && current.id === deploymentId) throw new ApiError(409, 'already_current', 'That deployment is already serving production.');
    const cleanReason = typeof reason === 'string' ? reason.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 200) : '';
    await vercel.rollback(deploymentId, cleanReason || `Rollback requested by ${actor.email}`);
    await record({ actor: actor.email, kind: 'rollback', sha: target.sha, deploymentId, previousDeploymentId: current ? current.id : null, details: { reason: cleanReason } });
    return { rolledBackTo: target, previous: current };
  }

  function verificationHost(deployment) {
    const hosts = new Set();
    if (config.vercel.productionUrl) hosts.add(new URL(config.vercel.productionUrl).host);
    for (const alias of deployment.aliases) hosts.add(String(alias).replace(/^https?:\/\//, ''));
    return [...hosts].find((host) => /^[a-z0-9.-]+$/i.test(host)) || null;
  }

  async function verify(id) {
    needVercel();
    requireDeploymentId(id);
    const deployment = normalize(await vercel.getDeployment(id));
    const project = await vercel.getProject();
    const checks = [];
    const add = (checkId, label, status, detail) => checks.push({ id: checkId, label, status, detail });

    add('state', 'Deployment finished building', deployment.state === 'READY' ? 'pass' : 'fail', `State is ${deployment.state}.`);
    add('target', 'Deployment targets production', deployment.target === 'production' ? 'pass' : 'fail', `Target is ${deployment.target}.`);
    const pointer = project.targets && project.targets.production;
    const live = Boolean(pointer && (pointer.id || pointer.uid) === deployment.id) || (deployment.substate === 'PROMOTED' && !pointer);
    add('live', 'Serving production domains', live ? 'pass' : 'fail', live ? 'Production domains point at this deployment.' : deployment.substate === 'STAGED' ? 'Built but not promoted yet.' : 'Production domains point at a different deployment.');

    const host = live ? verificationHost(deployment) : null;
    if (!host) {
      add('health', 'Site responds on its production domain', 'skipped', live ? 'No production domain is known. Set CMS_PRODUCTION_URL.' : 'Not live, so the production domain was not checked.');
    } else {
      try {
        const response = await fetchImpl(`https://${host}/api/health`, { signal: AbortSignal.timeout(8000), headers: { 'Cache-Control': 'no-cache' }, redirect: 'manual' });
        const body = response.ok ? await response.json().catch(() => null) : null;
        if (!response.ok || !body || body.ok !== true) {
          add('health', 'Site responds on its production domain', 'fail', `Health check returned HTTP ${response.status}.`);
        } else {
          add('health', 'Site responds on its production domain', 'pass', `HTTP ${response.status} from ${host}.`);
          if (body.commit && deployment.sha) add('commit', 'Running the expected commit', body.commit === deployment.sha ? 'pass' : 'fail', body.commit === deployment.sha ? `Reports ${deployment.shortSha}.` : `Reports ${String(body.commit).slice(0, 7)}, expected ${deployment.shortSha}.`);
          else add('commit', 'Running the expected commit', 'skipped', 'The site did not report a commit SHA.');
        }
      } catch {
        add('health', 'Site responds on its production domain', 'fail', `Could not reach ${host}.`);
      }
    }
    return { deployment, checks, passed: checks.every((check) => check.status === 'pass' || check.status === 'skipped') && checks.some((check) => check.id === 'live' && check.status === 'pass') };
  }

  return { overview, branches, commits, createBranch, listDeployments, getDeployment, createPreview, deployProduction, promote, rollbackCandidates, rollback, verify };
}

module.exports = { createDeployService, isValidBranchName, normalize };
