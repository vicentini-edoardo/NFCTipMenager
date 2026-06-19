# AFM Tip Tracker

NFC-based probe tip usage tracker for AFM labs. Tap a box → usage is logged automatically.

## How it works

1. Each tip box has an NFC sticker programmed with a URL like `/t/box-001`
2. User taps sticker → phone opens the tap page → name is read from `localStorage`
3. Tap is logged to the database automatically
4. Confirmation screen shows tip number, model, box ID, and timestamp

## Stack

- **Runtime:** Cloudflare Workers (bundled by Wrangler; source split into ES modules under `src/`)
- **Database:** Cloudflare D1 (SQLite)
- **Email alerts:** Brevo transactional email API
- **Auth:** Admin key via Wrangler secret + HTTP Basic Auth on `/admin`; signed one-time tokens gate user self-corrections; per-box rate limiting on the public tap endpoint

## Project layout

```
src/
  worker.js        # request router + endpoint handlers
  lib/
    http.js        # escaping, JSON, auth helpers
    token.js       # signed edit tokens (HMAC) for /log/set-tip
    email.js       # Brevo email helpers
  pages/
    tip.js         # public tap page (HTML/JS)
    admin.js       # admin dashboard (HTML/JS)
schema.sql         # full schema for new databases
migrations/        # incremental migrations for existing databases
test/              # unit tests (vitest)
```

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- Wrangler CLI: `npm install -g wrangler`
- Logged in: `wrangler login`
- A [Brevo](https://brevo.com) account (free — 300 emails/day)

## First-time setup

### 1. Create the D1 database

```bash
wrangler d1 create afm-tips-db
```

Copy `wrangler.toml.example` to `wrangler.toml` and paste your `database_id`:

```bash
cp wrangler.toml.example wrangler.toml
```

```toml
[[d1_databases]]
binding = "afm_tips_db"
database_name = "afm-tips-db"
database_id = "PASTE_YOUR_DATABASE_ID_HERE"
```

> `wrangler.toml` is gitignored — your real database ID stays local only.

### 2. Apply the schema

```bash
# Local dev
wrangler d1 execute afm-tips-db --local --file=schema.sql

# Production
wrangler d1 execute afm-tips-db --remote --file=schema.sql
```

### 3. Set secrets

```bash
# Admin password — protects /admin and all admin API endpoints
wrangler secret put ADMIN_KEY

# Brevo API key — enables email alerts
wrangler secret put BREVO_API_KEY

# Optional: secret used to sign one-time tip-edit tokens.
# If omitted, ADMIN_KEY is used as the signing secret.
wrangler secret put SIGNING_SECRET
```

**Getting the Brevo API key:**
1. Sign up at [brevo.com](https://brevo.com)
2. Account (top right) → SMTP & API → API Keys → Generate new key
3. Verify your sender email: Senders & IPs → Senders → Add your address → click the verification link sent to you

> Set the verified Brevo sender address in `wrangler.toml` under `[vars] SENDER_EMAIL`. The rate-limit binding is also defined there — adjust `limit`/`period` to taste.

### 4. Deploy

```bash
wrangler deploy
```

### 5. Set the alert email in the admin dashboard

Open `/admin` → **Settings** section → enter the recipient email → click **Save**.

The designated person receives a welcome email immediately confirming they are the alert recipient, with a link to the admin dashboard.

## Local development

```bash
npm install          # one-time
npm run dev          # wrangler dev
```

Worker runs at `http://localhost:8787`. Test a tap at `http://localhost:8787/t/box-001`.

### Tests & linting

```bash
npm test             # vitest — unit tests for helpers and token signing
npm run lint         # eslint
```

CI runs lint + tests on every push and pull request (`.github/workflows/ci.yml`).

### Migrating an existing database

New databases get everything from `schema.sql`. Databases created before the
`alerted_at` column, indexes, and `UNIQUE(box_id, tip_number)` constraint were
added should apply the migration once:

```bash
wrangler d1 execute afm-tips-db --remote --file=migrations/0001_add_indexes_and_alerted_at.sql
```

## NFC stickers

Program each sticker with its box URL:

```
https://<your-worker>.workers.dev/t/<box-id>
```

Use any unique string as `<box-id>` (e.g. `box-001`, `otespa-lot-42`). Stick to `[a-z0-9-_]`.

## Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/t/<box-id>` | none | Tap page served to phone |
| POST | `/log` | rate-limited | Records a tip taken; returns a signed edit token |
| POST | `/log/set-tip` | edit token | User self-corrects the tip number they just logged |
| POST | `/log/correct` | admin key | Admin corrects any log entry |
| POST | `/log/add` | admin key | Admin inserts a missed entry |
| POST | `/register` | admin key | Registers a new box |
| POST | `/box/update` | admin key | Updates box metadata |
| POST | `/box/reset-tips` | admin key | Deletes all usage log entries for a box |
| POST | `/settings` | admin key | Saves a settings value (e.g. alert email) |
| POST | `/settings/test-email` | HTTP Basic | Sends a test email and returns the Brevo response |
| GET | `/admin` | HTTP Basic | Dashboard — logs, boxes, settings |
| GET | `/export/csv` | HTTP Basic | Download logs or boxes as CSV |

## Admin dashboard

Navigate to `/admin`. Username can be anything; password is the `ADMIN_KEY` secret.

## Low-tip email alerts

An automatic email is sent the first time a box drops to its low-tip threshold
(default **5** tips remaining, configurable in `/admin` → Settings). The alert
fires once per box; raising the quantity or resetting the box's tips re-arms it.

**Setup summary:**
1. Verify your sender address in Brevo (Senders & IPs → Senders)
2. Set `SENDER_EMAIL` in `wrangler.toml` `[vars]` to that verified address
3. Add `BREVO_API_KEY` secret via `wrangler secret put BREVO_API_KEY`
4. Deploy, then set the recipient email (and optionally the threshold) in `/admin` → Settings

**Test the email pipeline:**
```bash
curl -X POST https://<your-worker>.workers.dev/settings/test-email \
  -u "admin:YOUR_ADMIN_KEY"
```

Returns the raw Brevo API response so you can diagnose any delivery issues.

To change the alert recipient, enter a new email in the Settings section and save. The new address receives a welcome email; alerts go to the new address from that point on.

## Database schema

**`boxes`** — registered tip boxes

| Column | Type | Notes |
|--------|------|-------|
| box_id | TEXT PK | Unique identifier, matches the URL slug |
| tip_model | TEXT | e.g. `OTESPA-R3` |
| lot | TEXT | optional |
| quantity | INTEGER | total tips in box |
| purchase_date | TEXT | optional |
| status | TEXT | `active` / `inactive` |
| registered_by | TEXT | optional |
| registered_at | TEXT | ISO timestamp |
| location | TEXT | e.g. `Lab A, Shelf 2` |
| alerted_at | TEXT | set when a low-tip alert fired; cleared on refill/reset |

> `usage_log` has `UNIQUE(box_id, tip_number)` plus indexes on `box_id` and `timestamp`. The next tip number is assigned atomically on insert to avoid collisions between simultaneous taps.

**`usage_log`** — tap events

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | autoincrement |
| timestamp | TEXT | ISO timestamp |
| box_id | TEXT | foreign key to boxes |
| tip_model | TEXT | snapshot at time of tap |
| username | TEXT | from localStorage on the tapping device |
| tip_number | INTEGER | sequential per box |
| note | TEXT | optional admin note |

**`settings`** — key/value store for runtime configuration

| key | value |
|-----|-------|
| `alert_email` | recipient for low-tip alerts |
| `alert_threshold` | tips-remaining level that triggers an alert (default 5) |
