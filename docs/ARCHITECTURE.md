# Architecture

```
Browser
  |  /            static site (CDN)  --fetch-->  /api/public/content
  |  /admin/      static shell (CDN) --fetch-->  /api/auth/*, /api/admin/*
  v
Vercel
  static:    dist/  (public/ + admin/ copied by scripts/build.js)
  function:  api/index.js  -> Express app (server/app.js)
                |
                +-- auth/        PKCE login, sealed session cookie, guard
                +-- api.js       admin routes (all behind the guard)
                +-- storage.js   content service: draft, backups, publish
                +-- images.js    uploads, library
                +-- deploy/      GitHub + Vercel clients and rules
                |
                +--> Supabase Auth      (Google OAuth, token verification)
                +--> Supabase Postgres  (via PostgREST, service role, RPC functions)
                +--> Supabase Storage   (images, public bucket)
                +--> GitHub REST API    (server-side token)
                +--> Vercel REST API    (server-side token)
```

## Why this shape

- **One function.** The existing Express backend is kept and exported from `api/index.js`. Vercel runs it as a single function, which avoids the per-deployment function limit on Hobby plans and keeps the route modules intact. `vercel.json` rewrites `/api/*` to it.
- **Static assets stay static.** `scripts/build.js` copies `public/` and `admin/` into `dist/`, so the repository layout is unchanged. Express does not serve static files on Vercel.
- **The admin shell is public code, not public data.** `/admin/` is a static page containing no secrets. Everything it can do goes through `/api/admin/*`, where the server authenticates and authorises every request. Hiding the shell would add nothing.
- **Hash routing** (`/admin/#/projects`) means refresh and direct navigation always load the shell. `/admin` is rewritten to `/admin/index.html`, and asset URLs are absolute so both `/admin` and `/admin/` work.

## Authentication flow

1. `GET /api/auth/login` creates a PKCE verifier, seals it in a short-lived `HttpOnly` cookie and redirects to Supabase `/auth/v1/authorize` (Google, `code_challenge_method=s256`).
2. Google returns to Supabase, which returns to `GET /api/auth/callback?code=...` on this site.
3. The server exchanges the code with the verifier (`/auth/v1/token?grant_type=pkce`). A code obtained by anyone else fails because it is bound to the verifier in this browser's cookie.
4. The returned user must have a **Google identity**, a **verified email matching** the account email, and be on `ADMIN_ALLOWED_EMAILS`. Otherwise the new Supabase session is revoked and the attempt is audited.
5. The session (access token, refresh token, timestamps) is sealed with AES-256-GCM into one `HttpOnly`, `SameSite=Lax`, `Secure` cookie (`__Host-` prefixed on HTTPS). JavaScript never sees tokens.
6. Each admin request: unseal, enforce absolute and idle lifetime, refresh the access token if due, **verify it against Supabase Auth**, re-check the allowlist, then (for non-GET) check Origin and an HMAC CSRF token derived from the session id.
7. Sensitive actions (branch creation, previews, production, promote, rollback) skip the 30-second verification cache and re-verify with Supabase on that request.

## Data model

| Table | Purpose |
| --- | --- |
| `cms_draft` | The single editable document plus a `revision` counter |
| `cms_backups` | The previous draft, written inside the same transaction as every save/restore |
| `cms_publications` | Append-only history of what went live |
| `cms_media_assets` | Uploaded image records (path, type, size, URL, uploader) |
| `cms_audit_log` | Append-only audit trail |
| `cms_deployment_events` | Who triggered each branch/preview/production/rollback action |
| `cms_rate_limits` | Shared fixed-window counters |

`cms_save_draft` locks the draft row, checks `expected_revision`, writes the backup and updates the draft atomically. Two simultaneous saves based on the same revision cannot both succeed.

Content is validated in Node (`server/validate.js`, unchanged from the local CMS) before it reaches the database; the database adds structural constraints.

## Editing versus publishing

`PUT /api/admin/content` writes the draft. `POST /api/admin/publish` copies the draft to `cms_publications` **only if the revision the user reviewed is still current**. The public site reads the latest publication through `cms_get_published()` using the anon key, cached for 30 seconds at the CDN. If the API fails, `script.js` falls back to `data/portfolio.json`, then to built-in content.

## Images

Uploads go through the function (multipart, 4 MB) to Supabase Storage. The server checks the extension, the declared type and the **magic bytes** (JPEG, PNG, WebP only; SVG is refused), generates a random file name and records the asset. Images referenced by the draft or the live site cannot be deleted. Images committed in `public/images/` are listed read-only.

## Deployment Center

All calls are server-side. The browser only ever receives normalised results.

| Screen | GitHub | Vercel |
| --- | --- | --- |
| Overview | `GET /repos/{o}/{r}` | `GET /v9/projects/{id}`, `GET /v6/deployments` |
| Versions | `GET /commits`, `GET /commits/{sha}` | `GET /v6/deployments` (status per commit) |
| Branches | `GET /branches`, `POST /git/refs` (create only) | `GET /v6/deployments` |
| Previews | `GET /compare/{sha}...{ref}` | `POST /v13/deployments` (no target) |
| Production | `GET /compare/{sha}...{ref}` | `POST /v13/deployments` (`target: production`), `POST /v10/projects/{id}/promote/{dpl}` |
| Rollbacks | none | `GET /v6/deployments?target=production&state=READY`, `POST /v1/projects/{id}/rollback/{dpl}` |

Production protections enforced on the server:

- A full 40-character SHA that exists on GitHub and is reachable from the chosen branch.
- Typed confirmation equal to the short SHA.
- By default, a **finished preview of the exact commit** must exist.
- No second production build while one is running.
- The code never sends `PATCH`, `PUT` or `DELETE` to GitHub or Vercel, never updates a ref and never creates a branch outside `dev/`.
- After a build finishes, **verification** checks that the deployment is READY, targets production, is the one serving the production domain, answers `/api/health`, and reports the expected commit.

Rollback uses Vercel's rollback endpoint: no rebuild, nothing deleted, the replaced deployment stays in history.

## Limits of the design

- The admin cannot publish code changes to Git; code is changed by pushing to GitHub as before. The Deployment Center chooses and ships versions.
- One editor is assumed. The revision check protects against accidental overwrites, but there is no merge.
- The audit log records actions, not full diffs. Content history lives in backups and publications.
