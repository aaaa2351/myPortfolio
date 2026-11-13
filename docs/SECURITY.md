# Security

## Controls

| Area | Control |
| --- | --- |
| Identity | Google sign-in through Supabase Auth with server-side PKCE. Requires a Google identity with a verified email. |
| Authorisation | `ADMIN_ALLOWED_EMAILS`, checked case-insensitively, exact match, on every request. Empty list means nobody gets in. |
| Enforcement | One guard mounted before every `/api/admin` route. A test enumerates 27 admin routes unauthenticated and asserts 401, and asserts the guard precedes all routes in the router. |
| Sessions | AES-256-GCM sealed cookie, `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix on HTTPS. Absolute (default 12 h) and idle (default 60 min) expiry. Refresh tokens never reach JavaScript. |
| CSRF | `SameSite=Lax`, required same-origin `Origin` header, `Sec-Fetch-Site` check and an HMAC token bound to the session id on every non-GET request. |
| Revocation | Access tokens are verified with Supabase. Normal requests may use a 30-second cache. Deployment actions always verify live. Logout revokes the session at Supabase. |
| Rate limiting | Postgres-backed shared counters: sign-in 20 per 10 min per IP, callback 30 per 10 min, writes 60 per min per user, uploads 30 per 10 min, deployment actions 15 per 10 min. Falls back to per-instance counters if the database is unreachable. |
| Database | RLS on with no policies, all privileges revoked from `anon` and `authenticated`, `SECURITY DEFINER` functions with a fixed `search_path` and `EXECUTE` limited to the service role. Append-only audit, publications and events. |
| Secrets | Only in server environment variables. The service key, GitHub token and Vercel token are never sent to the browser; a test scans the admin code for secret patterns. Previews should not receive the service key. |
| Uploads | Extension plus declared type plus magic bytes, size limit, random names, no SVG, stored outside the code deployment. |
| Output | Strict CSP (`script-src 'self'`, no inline script), `nosniff`, `X-Frame-Options`, HSTS, `Permissions-Policy`, `noindex` on `/admin`. API responses are `no-store`. |
| Input | JSON body size cap, strict content validation, strict branch/SHA/deployment-id formats, no user-supplied URLs are ever fetched. |
| Deployments | Typed confirmation, commit-on-branch proof, preview-first, one build at a time, create-only branches, no destructive Git or Vercel verbs. |
| Audit | Sign-ins, denials, saves, restores, publishes, uploads, deletes and every deployment action, with actor, IP and outcome. |

## Threats considered

- **Someone else signs in with an allowed email address.** Requires a Google identity with matching verified email. Disabling the Email provider and, after first login, new sign-ups removes the other routes.
- **Stolen session cookie.** Limited by idle and absolute expiry and by revocation on logout. A cookie stolen from a compromised browser is usable until then; this is the normal limit of cookie sessions.
- **Cross-site request forgery.** Blocked by `SameSite`, Origin check and the CSRF token.
- **Cross-site scripting.** No inline script allowed by CSP; the admin builds DOM nodes rather than HTML strings; uploads cannot be SVG or HTML.
- **A leaked GitHub or Vercel token.** Scope the GitHub token to one repository and turn on branch protection. Tokens carry expiry dates.
- **A malicious or buggy branch deployed as a preview.** Previews should hold no secrets and have the admin disabled.
- **Direct database access with the public key.** Refused by privileges and RLS. Only `cms_get_published()` is callable.

## Residual risks and limits

- The 30-second verification cache means a revoked token can still be accepted on non-sensitive requests for up to 30 seconds.
- Concurrent refreshes can occasionally invalidate a session when Supabase refresh-token rotation is strict. The user simply signs in again.
- IP-based limits trust `X-Forwarded-For`, which Vercel sets. Do not run this app behind an untrusted proxy without reviewing `server/http/client-ip.js`.
- The admin shell (HTML, JS, CSS) is publicly downloadable. It contains no secrets.
- Image deletion does not scan backups; restoring an old backup can reference a deleted image.
- Nothing here replaces enabling 2-step verification on your Google, GitHub and Vercel accounts.
