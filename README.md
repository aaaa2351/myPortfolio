# Portfolio CMS

A public portfolio at `/` and a private, Google-authenticated dashboard at `/admin`, backed by Supabase and deployed on Vercel. The original local CMS (homepage, profile, projects, tools and services editors, image library, drag sorting, validation, live preview, backups and restore) is preserved and now works remotely.

| Path | What it is |
| --- | --- |
| `/` | Public portfolio. Reads the **published** content from `/api/public/content` and falls back to `public/data/portfolio.json`. |
| `/admin` | Dashboard. Sign in with an allowlisted Google account. |
| `/api/*` | One Express app running as a single Vercel Function (`api/index.js`). |

## What changed from the local version

- **Auth:** Google OAuth through Supabase Auth, run server-side (PKCE). The session is a sealed, `HttpOnly`, `SameSite=Lax` cookie. Every admin endpoint checks the session, the email allowlist and a CSRF token on the server.
- **Data:** Supabase PostgreSQL holds the draft, backups, publications, audit log and media records. Supabase Storage holds uploaded images. Nothing depends on the server's disk.
- **Editing is separate from publishing:** *Save* updates the draft. *Publish* makes the saved draft live. Publication history is permanent and any version can be republished.
- **Safe saves:** every save carries the revision it was based on. A second device or tab cannot silently overwrite newer work.
- **Deployment Center:** Overview, Versions, Branches, Previews, Production, History and Rollbacks, using the GitHub and Vercel APIs from the server only.

## Documentation

- [docs/SETUP.md](docs/SETUP.md): Supabase, Google OAuth, GitHub, Vercel, environment variables, deployment.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it fits together and why.
- [docs/SECURITY.md](docs/SECURITY.md): protections, threat model and limits.
- [TESTING_REPORT.md](TESTING_REPORT.md): what was tested, what was not.
- [.env.example](.env.example): every variable.

## Local development

```bash
npm install
cp .env.example .env        # fill in Supabase values and ADMIN_ALLOWED_EMAILS
npm run db:seed             # one-off: creates the draft from public/data/portfolio.json and imports data/backups
npm run dev                 # http://localhost:3000  and  http://localhost:3000/admin/
```

Local development uses a real Supabase project (a free development project is fine). Add `http://localhost:3000/api/auth/callback` to its redirect URLs.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local server with reload. |
| `npm start` | Local server. |
| `npm run build` | Assembles `dist/` (public site plus the admin shell). Vercel runs this. |
| `npm test` | Unit, API, security, Deployment Center and UI tests. No external services needed. |
| `npm run test:db` | Database tests. Needs `TEST_DATABASE_URL` (and `TEST_POSTGREST_BIN` for the supabase-js tests). |
| `npm run db:seed` | Seed the database. Idempotent. |
| `npm run vercel:config` | Regenerate `vercel.json` (keeps its CSP in sync with the server). |

## Project layout

```
api/index.js              Vercel entry. Exports the Express app.
server/                   Express app, auth, repositories, deploy services
  auth/                   PKCE login, sealed sessions, guard, routes
  deploy/                 GitHub and Vercel clients, Deployment Center rules
  repo/                   Supabase repository and storage adapter
admin/                    Dashboard (vanilla ES modules, unchanged design)
public/                   Public portfolio and bundled fallback data
supabase/migrations/      SQL: tables, functions, RLS, privileges, storage bucket
scripts/                  build, seed, vercel.json generator
test/                     node:test suites (+ test/db for Postgres)
docs/                     Setup, architecture, security
```
