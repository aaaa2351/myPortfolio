# Testing report

Run in a Linux sandbox: Node 22.23, PostgreSQL 16.15, PostgREST 12.2.3 (downloaded for the tests only), jsdom. No real Supabase, Google, GitHub or Vercel account was available, so none was contacted. Nothing was deployed, pushed or changed outside the sandbox.

## 1. Executed: 83 tests, 83 passing

| Suite | Tests | What it covers |
| --- | ---: | --- |
| `test/unit.test.js` | 9 | Cookie hardening, session sealing and tamper detection, CSRF binding, allowlist and Google-identity rules, configuration defaults and clamping, key-order-independent content comparison, JSON body parsing (plain Node and a simulated Vercel pre-parsed body), rate-limit fallback, client IP trust |
| `test/auth.test.js` | 18 | PKCE login redirect and verifier cookie; success path; wrong-verifier code rejected; non-allowlisted, non-Google, unverified and look-alike emails refused, revoked and audited; every one of 27 admin routes returns 401 unauthenticated; guard precedes all routes; forged/foreign cookies; CSRF, Origin and `Sec-Fetch-Site`; idle and absolute expiry; server-side token refresh and cookie rotation; revoked tokens blocked on sensitive actions; logout; login rate limit; admin disabled on previews; unconfigured and empty-allowlist lockout |
| `test/admin-api.test.js` | 13 | Seeding, save with backup and revision, validation errors, two-device conflict, backups list/inspect/restore, draft vs publish separation, republish, uploads by magic bytes, oversize and wrong-type refusal, image-in-use delete protection, status, audit entries, malformed/oversized bodies, headers, write rate limit |
| `test/deploy.test.js` | 16 | Request shapes sent to GitHub/Vercel; overview; unconfigured services name missing variables and call nothing; branches and commits; create-only branch rules and name validation; previews; production confirmation, commit-on-branch, preview-first and one-build-at-a-time; promote; rollback list and restore; rejected rollback; verification checks; history with initiator; proof that only GET/POST are ever sent and `master` is never written; deployment rate limit; upstream error translation |
| `test/parity.test.js` | 4 | Behaviour carried over from the local CMS: validation rules, upload name sanitising, Host-header guard, static serving exposes nothing outside `public/` and the admin shell |
| `test/static.test.js` | 7 | `vercel.json` routing, single function, CSP equal to the server's, generated file up to date, build output contains no server code/data/secrets, no secret patterns in browser code, `.env.example` covers every variable read, ignore files |
| `test/admin-ui.test.js` | 4 | The real `admin/js/app.js` booted in jsdom against the real Express server: login screen and error messages; dashboard shell and navigation; save with revision; publish dialog and live site update; every Deployment Center screen rendering; creating a branch; typed confirmation gating a rollback and a production deployment; activity, publishing, backups and image views; session-expiry modal that keeps unsaved edits; conflict dialog |
| `test/db/migrations.test.js` | 9 | Migrations apply and re-apply on real PostgreSQL; RLS on all tables; `anon`/`authenticated` cannot read, write or call private functions; audit/publications/events are append-only even for the owner; atomic save, stale writer rejected with details, backup naming; **two concurrent saves: exactly one wins**; publish, republish and anon-readable snapshot; rate-limit window and reset; table constraints |
| `test/db/supabase-repo.test.js` | 3 | The real `createSupabaseRepo` through supabase-js, PostgREST (real JWT role switching) and Postgres; the anon key can read only the published snapshot; the **entire CMS** (sign-in, edit, no-op save, conflict, backup, restore, publish, public read, audit) on that real path |

Also run: `npm audit --omit=dev` reported 0 vulnerabilities; `node --check` on every admin module; `npm run build` produced `dist/`.

Real defects found by these tests and fixed: an unset session lifetime was clamped to 1 hour instead of 12; boolean config options were ignored; comparing stored with validated content by plain `JSON.stringify` would have created duplicate publications because Postgres `jsonb` does not preserve key order; the previews filter relied on an unverified Vercel query value; test-only port races.

Commands: `npm test` (71, no services needed). `npm run test:db` with `TEST_DATABASE_URL` and `TEST_POSTGREST_BIN` set (12). Without those variables the 12 database tests skip with a message.

## 2. Not executed (untested functionality)

These are implemented and unit-tested against fakes or documentation, but **never run against the real service**:

1. **The live Google/Supabase sign-in.** The fake Auth server verifies the S256 challenge arithmetic and the flow, but the endpoint paths and parameters (`/auth/v1/authorize`, `/token?grant_type=pkce`, `/token?grant_type=refresh_token`, `/user`, `/logout`) come from Supabase documentation and `supabase-js` behaviour, not from a live call. Your first real sign-in is the true test.
2. **Supabase Storage.** Uploads and deletes use an in-memory adapter in tests. `server/repo/supabase-media.js` is not exercised against a real bucket.
3. **Real GitHub and Vercel APIs.** The fakes follow the documented endpoints. Assumed, unverified details: `gitSource` with `org`/`repo`, the `meta.githubCommit*` fields on API-created deployments, `readySubstate` values, the `targets.production` pointer on the project, and list filtering. Verification via `/api/health` only runs once the site is live on Vercel.
4. **The Vercel runtime.** `vercel.json` (rewrites, headers, `includeFiles`, build and output settings) was checked statically and the build script was run, but `vercel build`, a preview and production deployment were not run. Behaviour of Vercel's request-body helpers is covered only by a simulation.
5. **A real browser.** UI tests run in jsdom. No visual, responsive-layout, keyboard or screen-reader checks, and no cross-browser run. The new CSS has not been looked at on screen.
6. **Image upload from the browser file picker.** The upload API is tested; the picker UI path is not exercised.
7. **HTTPS-only behaviour** (`__Host-` cookie, `Secure`, HSTS) is covered by configuration unit tests, not a real TLS session.
8. **Load, cold-start and multi-instance behaviour.** The shared rate-limit function and the revision lock were tested on one Postgres, not under serverless concurrency.
9. **The 4.5 MB platform body limit.** The app enforces 4 MB itself; Vercel's own limit was not exercised.

## 3. Preserved features

All original editors and behaviour are retained and use the same data format, validation and styling: homepage, profile and contact, projects, tools and services editors; image library and picker; drag sorting; field validation; live preview; review-changes popover; backups list/view/restore; unsaved-change guard; the original dashboard. The original `validate.js` is unchanged. The original 9 local tests are replaced by equivalents (see `parity.test.js`) because the server is no longer a local file server. Visible changes: a sign-in screen, a user menu with sign-out, Publish, Publishing and Activity pages, the Deployment group, image deletion for uploaded images, and the 4 MB upload limit (was 5 MB).

## 4. Security measures verified by tests

Server-side authentication and allowlist on every admin route; Google-identity and verified-email requirement; sealed `HttpOnly` cookies with expiry and refresh; CSRF, Origin and fetch-metadata checks; per-IP and per-user rate limits; RLS and revoked privileges on `anon`/`authenticated`; append-only audit; atomic saves; magic-byte upload checks; image-in-use protection; production confirmation, commit proof and preview-first guard; no destructive Git/Vercel verbs; secrets never in browser code or API responses; build output free of server code and data.

## 5. Known limitations

- A revoked access token can be accepted for up to 30 s on non-sensitive requests.
- Public content is cached up to 30 s at the CDN after publishing.
- Publishing changes the database only; `public/data/portfolio.json` is a fallback and is not rewritten.
- Uploads are capped at 4 MB.
- Single-editor model: conflicts are detected, not merged.
- Preview links may require a Vercel login (Deployment Protection).
- After a rollback, Vercel stops auto-assigning production domains until a deployment is promoted.
