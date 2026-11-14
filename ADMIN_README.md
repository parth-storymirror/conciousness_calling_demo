# Consciousness Calling website — server and admin

The site is now a small Node.js app: it serves the same pages as before, plus a database-backed API and a hidden admin.

## What was built

| Feature | Where |
|---|---|
| **Follow Book Updates** sign-up (stores the email, sends nothing) | Connect page form → `POST /api/subscribe` |
| **Subscribers list**, search, add, unsubscribe, delete, CSV export | Admin → Subscribers |
| **Write and send a message to all subscribers** (ZeptoMail) | Admin → Send email |
| **Scrolling banner under the menu on the home page**, with an optional download/link button | Admin → Top banner |
| **File uploads** (PDF, EPUB, Word, etc.) stored in the CDN bucket | Admin → Top banner → Upload |
| **My Writings fully editable**: title, body text, image (upload) and table blocks | Admin → My Writings |
| Site images stored in the bucket | `npm run upload-site-images` (see below) |

The admin is **not linked anywhere on the website**. Its address is whatever you set in `ADMIN_PATH`
(default `/cc-admin/`). Change it to something private. Anyone who finds the address still needs the password.

## Safety around email (important)

- **Nothing sends email on its own.** Signing up only stores the address. There is no welcome email.
- Sending is **off unless `EMAIL_SENDING_ENABLED=true`** is set on the server. In the admin you can still write and
  **preview** a message (preview never sends). The Send button stays disabled while the switch is off.
- To send, the admin must preview, type `SEND`, and confirm a second time. A message goes out one email at a time,
  to active subscribers only, each with its own unsubscribe link; people who unsubscribe mid-send are skipped.
- Local mode (`npm run dev`) and the automated tests use an in-memory database and a **fake** mail transport. They can
  never reach ZeptoMail, the real database, or the bucket.
- While building this, **no email was sent and the real database and bucket were never contacted.**

## First-time setup (on the server)

1. Copy `.env.example` to `.env` and fill it in (your existing `.env` already has most of it). Also set:
   `PUBLIC_SITE_URL`, `SESSION_SECRET` (32+ random characters), `ADMIN_PATH`, `TRUST_PROXY`.
2. `npm install --omit=dev`
3. `npm run create-admin` — asks for a username and password (hidden prompt). It creates the database tables if needed.
4. `npm start`
5. Open `https://your-domain/<ADMIN_PATH>/` and sign in.

`.env` is already in `.gitignore`. Never commit it.

## Moving the website's own images to the bucket (optional, one time)

```
npm run upload-site-images              # dry run: lists what would upload, uploads nothing
npm run upload-site-images -- --apply   # uploads to <bucket>/raghuveera-website/site/
```

Then set `SITE_IMAGES_ON_CDN=true` and restart. The server rewrites image addresses to the CDN copies on the fly,
so the repository files do not change. Images and files you upload from the admin go to the same website folder
(`raghuveera-website/images/` and `raghuveera-website/downloads/`).

## Turning email sending on (when you are ready)

1. Check `PUBLIC_SITE_URL`, `ZEPTO_MAIL_KEY`, `MAIL_FROM_ADDRESS` are correct and the sender domain is verified in ZeptoMail.
2. Set `EMAIL_SENDING_ENABLED=true` and restart.
3. Admin → Send email → write, preview, type `SEND`, confirm.

## Running locally (safe)

```
npm run dev      # in-memory database, files on disk, email disabled
npm test         # backend tests (fake mail transport only)
```

`npm run dev` prints a throwaway admin password at start. Data disappears when it stops.

## Hosting note

GitHub Pages only serves static files, so the sign-up form, banner, admin and editable My Writings need this Node
server (any Node host or VPS with PostgreSQL). The static pages keep working without it; the dynamic parts quietly
fall back (the My Writings page keeps its built-in content, and no banner shows).

## Security measures

- Admin passwords are hashed (scrypt); sessions are signed, expire (8 h), and use HttpOnly, SameSite=Strict cookies.
- Every change needs a CSRF token; sign-in is rate limited and locks an account for 15 minutes after 5 bad tries.
- Uploads are type-checked by content (no SVG/HTML), size-limited, and stored under random names in the site folder.
- All text from visitors and the admin is stored as plain text and shown with `textContent` (no HTML injection).
- Spreadsheet-formula-safe CSV export; honeypot and rate limit on the public sign-up form.
- Only the website's own folders are served (never `.env`, `server/`, `scripts/`, `.git`, `node_modules`).
- Admin pages send `noindex` and a strict Content-Security-Policy.

## Known limits

- One admin role (no separate staff accounts yet). Ask if you want more.
- Text blocks are plain text with paragraphs (no bold/links inside a paragraph).
- Sessions are stateless cookies, so "Sign out" ends the browser session but cannot invalidate a copied cookie before it expires.
