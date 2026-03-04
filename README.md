# NARFwiki

Private Wikipedia-style wiki web app with role-based access and WhatsApp bot management.

## Stack

- Node.js + Express
- PostgreSQL
- EJS server-rendered UI (Wikipedia-like layout)
- WhatsApp Cloud API webhook bot

## Features (MVP)

- Full-site authentication (session cookies + bcrypt hashed passwords)
- Roles: `admin`, `editor`, `reader`
- Article pages with:
  - Wikipedia-like tabs (`Article`, `Talk`, `Edit`, `View history`)
  - TOC auto-generated from headings
  - Internal links (`[[Page Name]]`)
  - Categories (`[[Category:Name]]` + manual categories field)
  - Basic infobox support (`{{Infobox Person | name=... }}`)
  - References via `<ref>...</ref>`
  - Redirect support (`#REDIRECT [[Target Page]]`)
  - Basic template transclusion (`{{Template:Name}}` / `{{Name}}`)
- Create/edit/delete pages
- Preview before save
- Revision history + diff view
- Talk pages
- Search (title + content snippets)
- Advanced search (PostgreSQL full-text ranking + snippet highlights)
- Category index pages
- Admin user management UI (registration disabled by default)
- WhatsApp bot commands:
  - `/search <query>`
  - `/read <title>`
  - `/create <title>` + message body + `/done`
  - `/update <title>` + full body + `/done`
  - `/append <title>` + body + `/done`
  - `/delete <title>`
  - `/history <title>`
  - `/diff <title> <revA> <revB>`
  - `/categories <title>`
  - `/setcategory <title> <CategoryName>`
- Editor AI assistant (GLM-5):
  - Highlight text and run AI proofread / grammar fix
  - Generate full article draft from notes in editor
- Image support:
  - Multi-image upload in editor
  - Drag-and-drop upload into editor side panel
  - Gallery picker to reuse previously uploaded images
  - Optional alt-text and caption before insertion
  - Insert markdown image links automatically
  - Images served from `/media/<filename>`

## Project Structure

- `src/server.js` web app
- `src/bot.js` WhatsApp bot service
- `src/services/wikiRenderer.js` rendering pipeline
- `src/services/wikiService.js` page/revision/category/talk data access
- `migrations/001_init.sql` database schema
- `docker-compose.yml` app + db + bot containers

## Environment

1. Copy `.env.example` to `.env`.
2. Fill required secrets/tokens:
   - `SITE_SECRET`
   - `DB_URL`
   - `ADMIN_BOOTSTRAP_USER`
   - `ADMIN_BOOTSTRAP_PASS`
   - `BOT_API_TOKEN`
   - `GLM_API_KEY`
   - Optional: `GLM_BASE_URL` (default `https://api.z.ai/api/paas/v4/`)
   - Optional: `GLM_MODEL` (default `glm-5`)
   - `WHATSAPP_BOT_TOKEN`
   - `WHATSAPP_VERIFY_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHITELISTED_PHONES` (comma-separated, digits only)
   - Optional: `WHATSAPP_BOT_PIN`

## Local Run (without Docker)

1. Install dependencies:
   - `npm install`
2. Ensure PostgreSQL is running and `DB_URL` points to it.
3. Run migrations:
   - `npm run migrate`
4. Seed initial admin:
   - `npm run seed:admin`
5. Start web app:
   - `npm run start:web`
6. Start bot service (separate terminal):
   - `npm run start:bot`

Then open `http://localhost:3000` and log in using the bootstrap admin credentials.

## Docker Compose Run

1. Copy `.env.example` to `.env` and fill values.
2. Start all services:
   - `docker compose up --build`
3. Web app: `http://localhost:3000`
4. Bot webhook endpoint: `http://localhost:3001/webhook`

The `web` service runs migrations and seeds admin automatically on startup.

## WhatsApp Bot Setup (Cloud API)

1. Configure your Meta app webhook URL to:
   - `https://<your-host>/webhook`
2. Set verify token to `WHATSAPP_VERIFY_TOKEN`.
3. Set access token to `WHATSAPP_BOT_TOKEN`.
4. Set sender number ID as `WHATSAPP_PHONE_NUMBER_ID`.
5. Whitelist operator phone numbers in `WHITELISTED_PHONES`.
6. (Optional) Set `WHATSAPP_BOT_PIN`; users must run `/auth <pin>` first.

## Security Notes

- No anonymous/public page access.
- No self-registration flow.
- All bot writes go through token-protected backend API.
- HTML output is sanitized before render.
- Security headers enabled via `helmet`.
- Gentle rate limiting for auth/API routes.
- Uploaded media is protected by session auth route (`/media/:filename`).
