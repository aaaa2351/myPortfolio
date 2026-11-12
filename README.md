# Portfolio CMS

A local-only content management system for the static portfolio in `public/`. The admin runs on your machine, edits `public/data/portfolio.json` and `public/images/`, and never deploys or pushes anything.

Stack: HTML5, CSS3, vanilla JavaScript, Node.js, Express, Multer, JSON files. No database, no build step.

## Start

```bash
npm install
npm start
```

- Admin: http://127.0.0.1:3000/admin/
- Portfolio: http://127.0.0.1:3000/

Use another port with `PORT=3100 npm start` (Windows PowerShell: `$env:PORT=3100; npm start`). Run the tests with `npm test`.

## Folder structure

```
portfolio-cms/
  package.json
  admin/                  dashboard (served at /admin/)
    index.html  admin.css
    js/  app.js api.js state.js ui.js picker.js preview.js sortable.js dom.js icons.js validators.js
    js/views/  dashboard projects homepage profile tools services images backups collection bind
  server/                 Express app
    index.js config.js security.js api.js storage.js images.js validate.js errors.js
  public/                 the static portfolio (this is what you deploy)
    index.html  styles.css  script.js
    data/portfolio.json   all editable content
    images/               site images; uploads go to images/uploads/
  data/backups/           timestamped copies of portfolio.json
  original-files/         your original index.html, styles.css, script.js, untouched
  test/api.test.js
```

## Add your existing images (required once)

The upload did not include your image files, so the CMS cannot show them yet. Copy them into `public/images/` keeping the same names and folders:

```
public/favicon.png
public/images/pexels-dkomov-34803979.jpg
public/images/avatar.jpg
public/images/cipher.png
public/images/fishSpot.jpg
public/images/html.jpg
public/images/css.jpg
public/images/git.svg
public/images/js.jpg
public/images/blender.jpg
public/images/wds/web.svg
public/images/wds/js.svg
public/images/wds/3d.svg
public/images/wds/design.svg
```

The Dashboard lists any referenced image that is missing. The Task Manager project uses a remote Unsplash URL, which works as is.

New uploads accept JPG, PNG and WebP up to 5 MB. Files are checked by their actual bytes, renamed to a safe unique name and stored in `public/images/uploads/`. Existing SVGs can be selected but not uploaded.

## Using the CMS

- Edit anything; changes are a draft. The top bar shows how many are unsaved and lists them.
- Open **Preview** to see the draft in the real portfolio at desktop, tablet or mobile width.
- **Save changes** (or Ctrl/Cmd+S) validates everything, copies the previous `portfolio.json` to `data/backups/`, then writes the new file atomically.
- **Backups** lists every saved version. View one, or restore it; the current version is backed up first.
- Deleting asks for confirmation. Nothing touches disk until you save.

## Content format

`public/data/portfolio.json` keeps your original field names: `projectList` (`name`, `imageSrc`, `description`, `appType`, `liveUrl`, plus `githubUrl`), `tools` (`name`, `logo`) and `wds` (`logo`, `title`, `description`). Each item has a stable `id` and an `updatedAt` set by the server. Other sections: `site`, `hero`, `profile`, `contact`, `socials`, `footer`, `meta`.

The public `script.js` loads this file with a relative `fetch`, escapes everything by building the page with DOM APIs, validates links and image paths again, and falls back to built-in copy of your original content if the file cannot be loaded.

## Security model (local-only, v1)

- Binds to `127.0.0.1` only. Requests whose `Host` is not `127.0.0.1:PORT` or `localhost:PORT` are refused, which blocks DNS rebinding.
- Writes require a matching `Origin`, a per-run CSRF token in `X-CSRF-Token`, and no cross-site `Sec-Fetch-Site`. No CORS headers are sent.
- Strict Content-Security-Policy on the admin; no inline scripts.
- Only `/admin`, `/api` and `public/` are served. Backups, `server/` and the project root are not reachable.
- Backup names are matched against a fixed pattern; image paths must live under `images/` with no `..`.
- Uploads: memory-only, 5 MB limit, MIME and extension allow-list, magic-byte check, server-generated names.
- Preview messages must come from the same origin and the parent window, use channel `portfolio-cms` version 1, and are re-sanitised before rendering.
- The server has no Git or deploy code.

## Deploy to Vercel

Deploy the `public/` folder as a static site. The CMS and `package.json` stay local.

1. Edit and save in the CMS. Check the Dashboard for missing images.
2. Commit yourself: `git add public && git commit -m "Update portfolio content"` and `git push`.
3. In Vercel, import the repository and set **Root Directory** to `public`, **Framework Preset** to `Other`, and leave the build and install commands empty.

CLI alternative: `cd public && vercel`. Because the page loads `data/portfolio.json` with a plain relative request, no server is needed in production. Vercel serves the new content after each deploy.

If your repository contains only the portfolio, you can instead move `public/` to the repository root.

## Things to review in your content

- All three projects point to `https://cipherquiz.vercel.app`; the Dashboard flags this.
- The three social icons have no URL yet, so they link to `#`.
- The copyright line keeps your original spacing: `© 2026 Okikiola . All rights reserved.`
- Nothing was added to `.gitignore` for `public/images/uploads`; commit uploads you want deployed.
