# Setup

Follow these in order. Nothing here deploys to production for you.

## 0. Prerequisites

- Node.js 20.12 or newer
- A Supabase project, a Google Cloud project, a GitHub repository, a Vercel project connected to that repository

## 1. Supabase

1. Create a project at supabase.com.
2. **Run the migrations.** Open *SQL Editor* and run these two files in order, each as a single script:
   1. `supabase/migrations/20261112000001_cms_core.sql`
   2. `supabase/migrations/20261112000002_storage.sql`

   Or with the CLI: `supabase link --project-ref <ref>` then `supabase db push`.
3. **Check the result** in *Table Editor*: seven `cms_*` tables, each showing *RLS enabled*. In *Storage*: a public bucket `portfolio-images` limited to 5 MB and JPEG/PNG/WebP.
4. **Copy your keys** from *Project Settings > API*:
   - `SUPABASE_URL`: the project URL
   - `SUPABASE_ANON_KEY`: the anon / publishable key
   - `SUPABASE_SERVICE_ROLE_KEY`: the service_role / secret key. **Server only. Never paste it into browser code, a screenshot or a chat.**

### What the migrations set up

- `cms_draft` (one row), `cms_backups`, `cms_publications`, `cms_audit_log`, `cms_media_assets`, `cms_deployment_events`, `cms_rate_limits`.
- Atomic functions: `cms_save_draft` (backup plus revision check in one transaction), `cms_publish`, `cms_republish`, `cms_seed_draft`, `cms_rate_limit`, and `cms_get_published`.
- Row Level Security is on for every table with **no policies**, and all privileges are revoked from `anon` and `authenticated`. Only the server (service role) can touch data, and only through these functions plus a few explicit grants.
- Publications, the audit log and deployment events cannot be updated, deleted or truncated, even by the table owner.
- Only `cms_get_published()` is callable by `anon`. It returns the latest published snapshot and nothing else. This is what lets preview deployments render the public site without holding the service key.

## 2. Google OAuth

1. In Google Cloud Console open *APIs & Services > OAuth consent screen*. Choose *External* (or *Internal* on Workspace). Add your Google address as a test user. Default scopes (`openid`, `email`, `profile`) are enough.
2. *Credentials > Create credentials > OAuth client ID > Web application*.
3. Under *Authorized redirect URIs* add exactly `https://<project-ref>.supabase.co/auth/v1/callback`. Supabase shows this URI on its Google provider page.
4. Copy the Client ID and Client Secret.
5. In Supabase: *Authentication > Sign In / Providers > Google*. Enable it and paste both values.
6. *Authentication > Providers*: disable the **Email** provider so Google is the only way in.
7. *Authentication > URL Configuration*:
   - Site URL: `https://your-domain.com`
   - Redirect URLs: `https://your-domain.com/api/auth/callback` and `http://localhost:3000/api/auth/callback`
8. After your first successful sign-in, turn **off** *Allow new users to sign up* (*Authentication > Sign In / Providers*). Nobody else can then even create a Supabase user. The CMS allowlist still applies either way.

## 3. GitHub token (Deployment Center)

*Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token*

- Resource owner: you or your org
- Repository access: **Only select repositories**, choose the portfolio repository
- Permissions: **Contents: Read and write**, **Metadata: Read-only**
- Set an expiry and note it in your calendar.

The write permission is used for one thing: creating `dev/*` branches. The code never updates, force-pushes or deletes refs, and never writes to the production branch. Also enable **branch protection on `master`** in GitHub (block force pushes and deletions; require pull requests if you like). That protects production even if a token leaks.

Variables: `CMS_GITHUB_TOKEN`, `CMS_GITHUB_OWNER`, `CMS_GITHUB_REPO`, `CMS_GITHUB_PRODUCTION_BRANCH` (default `master`).

## 4. Vercel

1. *Account Settings > Tokens*: create a token scoped to the team that owns the project. Variable: `CMS_VERCEL_TOKEN`.
2. *Project Settings > General*: copy **Project ID** (`CMS_VERCEL_PROJECT_ID`). For a team project also copy the **Team ID** from *Team Settings > General* (`CMS_VERCEL_TEAM_ID`).
3. *Project Settings > Git*: the repository is connected and the production branch is `master`.
4. *Project Settings > General*: set **Root Directory** to the repository root (it was `public` before). Framework preset: *Other*. Leave build and output overrides **off**, because `vercel.json` already sets `buildCommand: node scripts/build.js` and `outputDirectory: dist`.
5. *Environment Variables > Settings*: keep *Automatically expose System Environment Variables* on. The health check uses `VERCEL_GIT_COMMIT_SHA` to prove which commit is live.
6. *Domains*: add your domain and set `APP_URL` and `CMS_PRODUCTION_URL` to it.

### Environment variables by environment

| Variable | Production | Preview | Notes |
| --- | --- | --- | --- |
| `APP_URL` | yes | no | Canonical origin, no trailing slash |
| `SESSION_SECRET` | yes | no | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ADMIN_ALLOWED_EMAILS` | yes | no | Comma-separated |
| `SUPABASE_URL` | yes | **yes** | |
| `SUPABASE_ANON_KEY` | yes | **yes** | Lets previews show the published site |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **no** | Never give previews the secret key |
| `SUPABASE_STORAGE_BUCKET` | yes | no | Default `portfolio-images` |
| `CMS_GITHUB_*`, `CMS_VERCEL_*`, `CMS_PRODUCTION_URL` | yes | no | |
| `SESSION_MAX_AGE_HOURS`, `SESSION_IDLE_MINUTES`, `MAX_UPLOAD_MB` | optional | no | |
| `CMS_REQUIRE_PREVIEW_BEFORE_PRODUCTION` | optional | no | Default `true` |
| `ALLOW_ADMIN_ON_PREVIEW` | no | no | Leave unset (`false`) |

Previews run unmerged code, so by default they get no secrets and the admin is disabled there. Variable names are in `.env.example` with descriptions.

## 5. Seed the data

With a `.env` containing the Supabase values:

```bash
npm install
npm run db:seed
```

This creates the draft from `public/data/portfolio.json`, imports any valid files from `data/backups/` into the backups table, and publishes the initial content. It is safe to run more than once. (If you skip it, the first `/admin` visit creates the draft automatically; you then press Publish once.)

## 6. Try it locally first

```bash
npm run dev
```

Open `http://localhost:3000/admin/`, sign in with an allowlisted Google account, edit something, Save, Publish, and confirm `http://localhost:3000/` shows it. The Deployment Center works locally too if the GitHub and Vercel variables are set.

## 7. Deploy

1. Create a branch, commit and push it (do not push `.env`). Vercel builds a preview.
2. Open the preview. The public site should render from Supabase (previews have the anon key).
3. Merge to `master` when happy. Vercel builds production.
4. Visit `https://your-domain.com/admin`, sign in, and open *Deployment > Overview*. GitHub and Vercel should both show *connected*.

## 8. Go-live checklist

- [ ] `https://your-domain.com/api/health` returns `{"ok":true,...}` with the expected commit
- [ ] `/admin` loads on direct navigation and refresh, including `/admin/#/projects`
- [ ] Signing in with a non-allowlisted Google account is refused
- [ ] A signed-out request to `/api/admin/content` returns 401
- [ ] Save, Publish, then reload `/`: the change is visible
- [ ] Upload an image, use it, publish
- [ ] *Deployment > Branches*: create `dev/test`, then *Previews*: deploy it
- [ ] Turned off *Allow new users to sign up* in Supabase
- [ ] Branch protection enabled on `master`

## Operating notes

- **Preview links ask for a Vercel login** when Deployment Protection is on for previews (the default). That is expected.
- **After a rollback** Vercel stops auto-assigning production domains. The Production page then shows *Promote*; use it to resume.
- **Rotating `SESSION_SECRET`** signs everyone out. Rotate GitHub and Vercel tokens in the provider, then update the variable and redeploy.
- **Uploads are limited to 4 MB** because Vercel Functions reject request bodies over 4.5 MB.
- **Publishing updates content within about 30 seconds** (CDN cache). It does not change `public/data/portfolio.json`, which is only the fallback if the database is unreachable.
