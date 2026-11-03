# Endemion Ecosystem — Technical Audit Report

**Date:** 2026-11-03  
**Purpose:** Complete audit of existing authentication systems in preparation for unified OpenID Connect SSO integration

---

## Executive Summary

Two production platforms analyzed:

1. **Endemion** (endemion.online) — Manga reading platform
   - Buildless architecture (ES modules)
   - SQLite database
   - 16 migrations, mature auth system
   - Deployed via Docker + Caddy on VPS

2. **Endemion Life** (life.endemion.online) — Life simulation game
   - Modern monorepo (NestJS 12 + Next.js 16)
   - PostgreSQL + Redis
   - 2 migrations, recently deployed (2026-11-03)
   - Behind Caddy reverse proxy

**Key Finding:** Both platforms have secure, well-implemented authentication systems that are **fundamentally incompatible** due to:
- Different ID types (SQLite INTEGER vs PostgreSQL UUID)
- Different password hashing (PBKDF2 vs scrypt)
- Different session mechanisms (30-day cookies vs 365-day DB sessions)
- Different user models (users vs players/accounts separation)

**Recommendation:** Centralized OpenID Connect Provider (auth.endemion.online) is the **only viable path** to unified authentication without rewriting both platforms.

---

## Table of Contents

1. [Endemion (Main Site) Architecture](#1-endemion-main-site-architecture)
2. [Endemion Life Architecture](#2-endemion-life-architecture)
3. [Authentication Comparison Matrix](#3-authentication-comparison-matrix)
4. [Database Schema Analysis](#4-database-schema-analysis)
5. [Security Assessment](#5-security-assessment)
6. [Integration Challenges](#6-integration-challenges)
7. [Existing User Data](#7-existing-user-data)
8. [Technology Stack Summary](#8-technology-stack-summary)
9. [Production Infrastructure](#9-production-infrastructure)
10. [Recommendations](#10-recommendations)

---

## 1. Endemion (Main Site) Architecture

### 1.1 Technology Stack

- **Runtime:** Node.js 26 (also runs on Cloudflare Workers)
- **Database:** SQLite (WAL mode) via custom D1-compatible adapter
- **Frontend:** Buildless ES modules, no framework
- **Deployment:** Docker Compose + Caddy reverse proxy
- **Repository:** github.com/Yuta2Endo/Endemion

### 1.2 User Model

**Location:** `migrations/0001_init.sql` + `migrations/0016_platform.sql`

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                    -- Display name (2-40 chars)
  email TEXT NOT NULL UNIQUE,            -- Case-insensitive in code
  password_hash TEXT NOT NULL,           -- pbkdf2$100000$salt$hash
  consent_at TEXT NOT NULL,              -- GDPR consent timestamp
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
  blocked_at TEXT,                       -- Ban timestamp
  muted_until TEXT                       -- Community mute expiry
);

CREATE TABLE user_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- 3-24 chars, alphanumeric + underscore
  bio TEXT,                              -- ≤500 chars
  avatar_version INTEGER,                -- NULL = generated letter avatar
  avatar_color TEXT DEFAULT 'violet',
  is_public INTEGER DEFAULT 1,
  show_library INTEGER DEFAULT 1,
  show_activity INTEGER DEFAULT 1,
  notify_chapters INTEGER DEFAULT 1,
  notify_replies INTEGER DEFAULT 1,
  notify_follows INTEGER DEFAULT 1,
  notify_achievements INTEGER DEFAULT 1,
  updated_at TEXT
);
```

**Key Points:**
- **ID Type:** INTEGER AUTOINCREMENT (immutable, never changes)
- **Email:** UNIQUE constraint, normalized to lowercase in code (`functions/_lib/validate.js:10`)
- **Username:** Created on registration, unique case-insensitive, public URL `/u/<username>`
- **No email_verified column** — password reset is the only email ownership proof
- **ENDEMION ID concept:** Profile system with username, avatar, bio, achievements

### 1.3 Password Hashing

**File:** `functions/_lib/crypto.js`

**Algorithm:** PBKDF2-SHA256
- Iterations: 100,000 (limited by Cloudflare Workers)
- Salt: 16 random bytes, base64-encoded
- Key: 32 bytes (256 bits), base64-encoded
- Format: `pbkdf2$100000$<salt>$<hash>`

```javascript
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored).split("$");
  if (scheme !== "pbkdf2" || !salt || !hash) return false;
  const actual = await pbkdf2(password, fromBase64(salt), Number(iterations));
  return equalBytes(actual, fromBase64(hash));  // Constant-time comparison
}
```

**Timing Attack Mitigation:** Dummy hash computed for non-existent emails (`functions/api/auth/login.js:12`)

### 1.4 Sessions

**File:** `functions/_lib/session.js`

**Mechanism:**
- **Token:** 64-char hex (32 random bytes)
- **Cookie Name:** `endemion_session`
- **Attributes:** HttpOnly, SameSite=Lax, Secure (HTTPS only), Path=/
- **TTL:** 30 days from creation
- **Storage:** SHA-256 of token stored in `sessions.token_hash` (not plaintext)

```javascript
export async function currentUser(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await env.DB.prepare(
    `SELECT users.*, user_profiles.username, user_profiles.avatar_version, user_profiles.avatar_color
     FROM sessions JOIN users ON users.id = sessions.user_id
     LEFT JOIN user_profiles ON user_profiles.user_id = users.id
     WHERE sessions.token_hash = ? AND users.blocked_at IS NULL`
  ).bind(await sha256(token)).first();
  if (!row || row.expires_at < Date.now()) return null;
  return { id, name, email, role, username, avatar, ... };
}
```

**Logout:**
- Single device: `DELETE FROM sessions WHERE token_hash = ?`
- All devices: `DELETE FROM sessions WHERE user_id = ?` (after password change)

### 1.5 API Endpoints

**Location:** `functions/api/auth/`

| Endpoint | Method | Purpose | Rate Limit |
|----------|--------|---------|------------|
| `/api/auth/register` | POST | Create account + session | 30/IP/15min |
| `/api/auth/login` | POST | Authenticate + create session | 5/email + 30/IP/15min |
| `/api/auth/logout` | POST | Delete session | None |
| `/api/auth/forgot` | POST | Request password reset email | 3/email + 30/IP/15min |
| `/api/auth/reset` | POST | Reset password + revoke all sessions | None |
| `/api/me` | GET | Current user info | None |
| `/api/me` | PATCH | Update display name | None |
| `/api/me` | DELETE | Delete account (requires password) | None |
| `/api/me/password` | POST | Change password + revoke others | None |

**CSRF Protection:** `functions/api/_middleware.js` — POST/PUT/DELETE require `Origin` header matching site origin

**Turnstile:** Optional captcha on register/login/forgot (enabled if `TURNSTILE_SECRET_KEY` set)

### 1.6 Mail System

**File:** `functions/_lib/mail.js`

**Providers (priority order):**
1. **Unisender Go** (Russian service, if `UNISENDER_API_KEY` set)
2. **Resend** (US service, if `RESEND_API_KEY` set)

**Dev Mode:** `MAIL_DEV_MODE=1` on localhost returns reset link in API response instead of sending email

**Reset Email:**
- Token: 64-char hex (32 random bytes)
- TTL: 1 hour
- Link: `{origin}/reset?token={token}`
- One-time use (deleted via `DELETE ... RETURNING`)

### 1.7 Frontend

**Design System:**

**Files:** `public/assets/base.css`, `public/auth.html`

**Colors (CSS Variables):**
```css
:root {
  --bg: #07061a;              /* Deep dark background */
  --bg-soft: #100d2b;
  --panel: rgba(22, 18, 54, 0.78);
  --text: #f4f2ff;
  --muted: #a39fc8;
  --accent: #8b5cff;          /* Purple accent */
  --accent-strong: #7a3cff;
  --blue: #4f7cff;
  --pink: #ff6fb5;
  --green: #7be3b6;
  --red: #ff6b81;
  --radius: 20px;
  --font-display: "Unbounded", "Manrope", sans-serif;
  --font-body: "Manrope", sans-serif;
}
```

**Fonts:**
- Display: **Unbounded** (titles, weight 200-900)
- Body: **Manrope** (text, weight 200-800)
- Both loaded via `@font-face` with Cyrillic support

**Login State:**
- Server-side rendered navigation (`functions/_lib/layout.js:22-59`)
- Client polls `/api/me` on page load (`public/assets/app.js:178`)
- Shows user dropdown with avatar if logged in, else "Войти" link

**Pages:**
- `/auth.html` — Single page with login/register tabs
- `/profile` — ENDEMION ID profile page
- `/u/:username` — Public user profile

### 1.8 Security Headers

**File:** `public/_headers`

```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000
Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; ...
```

**CSP:** No `unsafe-inline` — all scripts external, no inline handlers

### 1.9 Production Deployment

**File:** `docker-compose.yml`, `Caddyfile`

```yaml
services:
  app:
    build: .
    environment:
      NODE_ENV: production
      TRUST_PROXY: "1"
    volumes:
      - ./data:/app/data
    expose:
      - "3000"

  caddy:
    image: caddy:2
    depends_on:
      - app
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
```

**Caddyfile:**
```
{$SITE_DOMAIN} {
  encode zstd gzip
  reverse_proxy app:3000 {
    header_up X-Forwarded-For {remote_host}
  }
}

life.{$SITE_DOMAIN} {
  reverse_proxy endemion-life-nginx:80 {
    header_up X-Forwarded-For {remote_host}
  }
}
```

**Automatic Migrations:** `server/index.mjs:53` — backup DB before applying pending migrations on startup

**VPS Location:** `/opt/endemion` on 185.175.156.196

---

## 2. Endemion Life Architecture

### 2.1 Technology Stack

- **Runtime:** Node.js 24+, pnpm 12.16.1
- **Backend:** NestJS 12.3.2
- **Frontend:** Next.js 16.4.4, React 19.3.0
- **Database:** PostgreSQL 18 + Prisma 7.10.1
- **Cache:** Redis 8 (rate limiting, sessions optional but unused)
- **Deployment:** Docker Compose + Nginx (behind-proxy mode)
- **Repository:** github.com/Yuta2Endo/Endemion-Life (private)

### 2.2 User Model

**Location:** `packages/database/prisma/schema.prisma`

**Key Concept:** **Player** = core identity (guest or account holder)

```prisma
model Player {
  id         String   @id @default(uuid()) @db.Uuid
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  lastSeenAt DateTime @default(now()) @map("last_seen_at") @db.Timestamptz(3)

  lives    Life[]
  actions  GameAction[]
  sessions Session[]
  account  Account?      // NULL = guest

  @@map("players")
}

model Account {
  id              String    @id @default(uuid()) @db.Uuid
  playerId        String    @unique @map("player_id") @db.Uuid
  email           String    @unique @db.VarChar(254)
  emailVerifiedAt DateTime? @map("email_verified_at") @db.Timestamptz(3)
  passwordHash    String    @map("password_hash") @db.VarChar(255)
  failedLogins    Int       @default(0) @map("failed_logins")
  lockedUntil     DateTime? @map("locked_until") @db.Timestamptz(3)
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  player Player      @relation(fields: [playerId], references: [id], onDelete: Cascade)
  tokens AuthToken[]

  @@map("accounts")
}

model Session {
  id         String    @id @default(uuid()) @db.Uuid
  tokenHash  String    @unique @map("token_hash") @db.Char(64)
  playerId   String    @map("player_id") @db.Uuid
  userAgent  String?   @map("user_agent") @db.VarChar(256)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  lastSeenAt DateTime  @default(now()) @map("last_seen_at") @db.Timestamptz(3)
  expiresAt  DateTime  @map("expires_at") @db.Timestamptz(3)
  revokedAt  DateTime? @map("revoked_at") @db.Timestamptz(3)

  player Player @relation(fields: [playerId], references: [id], onDelete: Cascade)

  @@map("sessions")
}
```

**Key Points:**
- **ID Type:** PostgreSQL UUID (v4, 128-bit)
- **Guest Support:** Players without accounts can play (anonymous progress)
- **Email Verification:** `emailVerifiedAt` column exists, 6-digit codes sent
- **Account Lockout:** 5 failed logins → 15 minute lock
- **No username** in current schema (no public profiles yet)

### 2.3 Password Hashing

**File:** `apps/api/src/auth/password.ts`

**Algorithm:** scrypt (Node.js crypto)
- N: 32,768 (CPU/memory cost = 2^15)
- r: 8 (block size)
- p: 1 (parallelization)
- Salt: 16 random bytes, base64url-encoded
- Key: 32 bytes (256 bits), base64url-encoded
- Format: `scrypt$32768$8$1$<salt>$<key>`

```typescript
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const normalized = password.normalize("NFKC");  // Unicode normalization
  const key = await scryptAsync(normalized, salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEMORY });
  return `scrypt$${N}$${r}$${p}$${encode(salt)}$${encode(key)}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // ... parse hash, derive key, timingSafeEqual comparison
}
```

**Security:** NFKC normalization, timing-safe comparison, dummy hash for non-existent accounts

### 2.4 Sessions

**File:** `apps/api/src/session/session.service.ts`

**Mechanism:**
- **Token:** 32-byte base64url (256 bits)
- **Cookie Name:** `el_session`
- **Attributes:** HttpOnly, SameSite=Lax, Secure (production), Path=/
- **TTL:** 365 days from creation
- **Storage:** PostgreSQL `sessions` table, SHA-256 of token
- **Touch Interval:** `lastSeenAt` updated once per hour (reduces DB writes)

```typescript
async current(request: Request): Promise<CurrentSession | null> {
  const token = this.tokenFrom(request);
  if (!token) return null;
  const session = await this.prisma.client.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { player: true }
  });
  const now = Date.now();
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now) return null;
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await this.prisma.client.session.update({ 
      where: { id: session.id }, 
      data: { lastSeenAt: new Date(now) } 
    });
  }
  return { sessionId: session.id, player: { id: session.player.id, ... } };
}
```

**Revocation:** Sessions can be individually revoked (`revokedAt` timestamp) or deleted

### 2.5 Guest Life Transfer

**File:** `apps/api/src/auth/auth.service.ts:161-169`

**Critical Feature:** When a guest registers, their game progress transfers to new account

```typescript
private async transferGuestLives(tx: Tx, guestPlayerId: string, targetPlayerId: string) {
  const locked = await tx.$queryRaw`SELECT id FROM players WHERE id = ${guestPlayerId}::uuid FOR UPDATE`;
  if (locked.length === 0) return 0;
  
  const moved = await tx.life.updateMany({ 
    where: { playerId: guestPlayerId }, 
    data: { playerId: targetPlayerId } 
  });
  await tx.gameAction.updateMany({ 
    where: { playerId: guestPlayerId }, 
    data: { playerId: targetPlayerId } 
  });
  await tx.player.delete({ where: { id: guestPlayerId } });  // Cascades sessions
  return moved.count;
}
```

**Row Lock:** Prevents concurrent transfer, ensures atomicity

### 2.6 API Endpoints

**Location:** `apps/api/src/auth/auth.controller.ts`

| Endpoint | Method | Purpose | Rate Limit |
|----------|--------|---------|------------|
| `/api/auth/me` | GET | Current player + account | None |
| `/api/auth/register` | POST | Create account, transfer guest lives | 10/min (IP+email) |
| `/api/auth/login` | POST | Authenticate + create session | 10/min (IP+email) |
| `/api/auth/logout` | POST | Delete current session | None |
| `/api/auth/verify-email` | POST | Confirm email with 6-digit code | 10/min |
| `/api/auth/resend-verification` | POST | Send new code | 10/min |
| `/api/auth/forgot-password` | POST | Request reset token | 10/min |
| `/api/auth/reset-password` | POST | Reset + revoke all sessions | 10/min |
| `/api/auth/sessions` | GET | List all sessions | None |
| `/api/auth/sessions/revoke` | POST | Revoke specific session | None |
| `/api/auth/sessions/revoke-others` | POST | Revoke all except current | None |

**Three-Layer Rate Limiting:**
1. **AuthThrottle:** 10/min per IP and per email (Redis or in-memory)
2. **RateLimitGuard:** 120/min per IP global API limit (Redis only)
3. **Nginx:** 30/min auth endpoints, 30/s other API (burst allowed)

**CSRF Protection:** `apps/api/src/common/request.guard.ts` — non-safe methods require `Origin` in `CORS_ORIGINS` + `application/json`

### 2.7 Email System

**File:** `apps/api/src/mail/mail.service.ts`

**Driver:** `MAIL_DRIVER` (smtp|file|memory|none)
- **smtp:** nodemailer via `SMTP_URL`
- **file:** JSON files to `.mail-outbox/` (development, used by Playwright tests)
- **memory:** in-memory array (tests)
- **none:** emails not sent

**Verification Code:**
- 6 digits (000000-999999)
- SHA-256 of `accountId:code` stored in `auth_tokens`
- 30-minute TTL
- Max 5 attempts
- New code invalidates old

**Password Reset:**
- 32-byte base64url token
- SHA-256 stored in `auth_tokens`
- 60-minute TTL
- One-time use, revokes all sessions

**Production Status (STAGE_01_5_REPORT:119):** SMTP not configured yet, file driver used

### 2.8 Frontend

**Design System:**

**Files:** `apps/web/src/app/globals.css`, `apps/web/tailwind.config.ts`

**Colors (CSS Variables):**
```css
:root {
  color-scheme: dark;
  --color-ink-950: #060608;     /* Deep backgrounds */
  --color-ink-900: #0c0c10;
  --color-ink-800: #14141a;
  --color-gold-400: #c9a25a;    /* Gold accents */
  --color-gold-500: #a8843f;
  --color-bone-100: #ece6da;    /* Light text */
  --color-blood-400: #cc6552;   /* Negative actions */
  --color-jade-400: #72b68f;    /* Positive actions */
  --font-display: "Cormorant Garamond", Georgia, serif;
  --font-sans: "Manrope", system-ui, sans-serif;
}
```

**Fonts:**
- Display: **Cormorant Garamond** (titles, serif)
- Body: **Manrope** (text, sans-serif)

**Login State:**
- `apps/web/src/components/account-link.tsx` polls `/api/auth/me` on pathname change
- Shows "Войти" (Sign In) for guests, "Аккаунт" (Account) for logged-in

**API Integration:**
- `apps/web/src/lib/api.ts` — fetch wrapper with `credentials: "same-origin"`
- `/api/*` proxied by Next.js in dev, nginx in production

**Pages:**
- `/account` — Login/register forms, email verification, device list
- `/reset-password` — Password reset form
- `/worlds` → `/create/{universeId}` — Game entry ("Играть" button flow)

### 2.9 Production Deployment

**Files:** `infrastructure/docker-compose.prod.yml`, `infrastructure/docker-compose.behind-proxy.yml`

```yaml
services:
  postgres:
    image: postgres:18-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:8-alpine
    command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru

  migrate:
    build: { target: migrate }
    command: ["node_modules/.bin/prisma", "migrate", "deploy"]
    depends_on:
      postgres: { condition: service_healthy }

  api:
    build: { target: api }
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://redis:6379
      TRUST_PROXY: loopback, uniquelocal
    depends_on:
      migrate: { condition: service_completed_successfully }

  web:
    build: { target: web }
    environment:
      API_INTERNAL_URL: http://api:4000
    depends_on:
      api: { condition: service_healthy }

  nginx:
    image: nginx:1.27-alpine
    # In behind-proxy mode: no published ports, joins external proxy network
```

**Behind-Proxy Mode:** `infrastructure/nginx/templates/behind-proxy.conf.template`
```nginx
listen 80 default_server;
server_name ${DOMAIN} _;

set $endemion_proto https;  # External Caddy handles HTTPS

location ^~ /api/auth/ {
  limit_req zone=endemion_auth burst=10 nodelay;
  proxy_pass http://endemion_api;
}

location /api/ {
  limit_req zone=endemion_api burst=60 nodelay;
  proxy_pass http://endemion_api;
}

location / {
  proxy_pass http://endemion_web;
}
```

**Caddy Integration:** External Caddy from main site proxies `life.{$SITE_DOMAIN}` → `endemion-life-nginx:80` on shared Docker network `endemion_default`

**VPS Location:** `/opt/endemion-life` on 185.175.156.196

---

## 3. Authentication Comparison Matrix

| Feature | Endemion | Endemion Life |
|---------|----------|---------------|
| **User ID Type** | SQLite INTEGER AUTO | PostgreSQL UUID v4 |
| **Password Hash** | PBKDF2-SHA256, 100k iter | scrypt N=32768, r=8, p=1 |
| **Hash Format** | `pbkdf2$100000$salt$hash` | `scrypt$32768$8$1$salt$key` |
| **Session Cookie** | `endemion_session` | `el_session` |
| **Session TTL** | 30 days | 365 days |
| **Session Storage** | SQLite (SHA-256 hash) | PostgreSQL (SHA-256 hash) |
| **Email Verification** | Not implemented | Optional (6-digit code) |
| **Guest Support** | No | Yes (Players without Account) |
| **Username** | Yes (unique, case-insensitive) | No (not in current schema) |
| **Display Name** | `users.name` (2-40 chars) | No (no accounts have names yet) |
| **Avatar** | Upload or generated letter | Not implemented |
| **Public Profile** | `/u/:username` | Not implemented |
| **Password Reset** | Email link, 1hr TTL | Email link, 1hr TTL |
| **Account Lockout** | No (rate limit only) | Yes (5 fails → 15min) |
| **CSRF Protection** | Origin header check | Origin check + JSON-only |
| **Rate Limiting** | In-DB table (15min window) | Redis or in-memory + Nginx |
| **Roles** | user/moderator/admin | No roles system |
| **Ban System** | `blocked_at` timestamp | No ban system |
| **Community Mute** | `muted_until` timestamp | No mute system |
| **Framework** | Buildless (vanilla JS) | NestJS 12 + Next.js 16 |
| **DB Migrations** | 16 migrations (mature) | 2 migrations (new) |
| **Deployed** | Active since Oct 2024 | Deployed 2026-11-03 |

---

## 4. Database Schema Analysis

### 4.1 Endemion Schema

**Tables Referencing `users.id`:**
- `sessions` (one-to-many)
- `user_profiles` (one-to-one, UNIQUE playerId)
- `password_resets` (one-to-many)
- `library` (reading progress)
- `positions` (chapter position)
- `reviews`, `comments`, `threads`
- `collections`, `follows`, `notifications`
- `votes`, `tournament_votes`
- `user_achievements`, `view_history`
- `reports`, `moderation_actions`
- `user_genres` (preferences)

**Total:** 19 tables with FK to users.id

**Migration Strategy Required:** If user IDs change, ALL references must be updated atomically

### 4.2 Endemion Life Schema

**Tables Referencing `players.id`:**
- `sessions` (one-to-many)
- `accounts` (one-to-one, UNIQUE playerId)
- `lives` (game characters, one-to-many)
- `game_actions` (action log, one-to-many)

**Nested References (via `lives.id`):**
- `life_snapshots` (versioned saves)
- `history_entries` (timeline events)

**Total:** 6 tables with direct/indirect FK to players.id

**Migration Note:** UUID format prevents accidental collision with other systems

### 4.3 Schema Incompatibility Analysis

| Aspect | Endemion | Life | Migration Impact |
|--------|----------|------|------------------|
| **ID Type** | INTEGER (4-8 bytes) | UUID (16 bytes) | CRITICAL: Cannot unify without full rewrite |
| **ID Generation** | Sequential AUTO_INCREMENT | Random UUID v4 | CRITICAL: No deterministic mapping |
| **Email Uniqueness** | UNIQUE constraint | UNIQUE constraint | Conflict resolution needed |
| **Username** | Required, unique | Not exists | Life needs username column |
| **Display Name** | `users.name` | Not exists | Life needs name column |
| **Email Case** | Lowercase in code | Lowercase in code | Compatible |
| **Password** | PBKDF2 | scrypt | Must rehash or use IdP |
| **Session Format** | 64-char hex | 32-byte base64url | Incompatible tokens |

**Conclusion:** Direct database merge is **not feasible**. Centralized IdP is the only viable approach.

---

## 5. Security Assessment

### 5.1 Endemion Security Strengths

✅ PBKDF2-SHA256 with 100k iterations (adequate)  
✅ Session tokens SHA-256 hashed in DB  
✅ HttpOnly, SameSite=Lax cookies  
✅ Constant-time password comparison  
✅ Timing attack mitigation (dummy hash)  
✅ CSRF protection via Origin check  
✅ CSP without `unsafe-inline`  
✅ All sessions revoked on password change  
✅ Parameterized SQL queries throughout  
✅ Rate limiting on auth endpoints  

### 5.2 Endemion Security Issues

⚠️ **Email uniqueness case-sensitivity mismatch:** Code normalizes to lowercase before INSERT, but SQLite UNIQUE is case-sensitive (low risk, unlikely bypass)

⚠️ **No email verification:** Anyone can register with any email without proof of ownership (password reset is the only verification)

⚠️ **Timing attack on registration:** Returns 409 immediately if email exists, no dummy hash (rate limiting mitigates)

⚠️ **No 2FA/MFA:** Only password authentication

⚠️ **Long-lived sessions (30 days):** Acceptable for content platform, but increases risk if device stolen

⚠️ **Password reset doesn't require old password:** Email access = full account access (standard design, but risky if email compromised)

### 5.3 Endemion Life Security Strengths

✅ scrypt with N=32768 (strong, memory-hard)  
✅ Session tokens SHA-256 hashed in DB  
✅ HttpOnly, SameSite=Lax cookies  
✅ Timing-safe password comparison  
✅ Dummy hash for non-existent accounts  
✅ CSRF protection (Origin + JSON-only)  
✅ Three-layer rate limiting (app + Redis + nginx)  
✅ Account lockout after 5 failed logins  
✅ Email verification system (optional)  
✅ Guest life transfer with row-level locking  

### 5.4 Endemion Life Security Issues

⚠️ **Session fixation during guest→account transition:** New token issued, but timing window exists where attacker could register before victim to claim guest's lives (row lock mitigates but doesn't eliminate)

⚠️ **Email enumeration via timing:** Account lookup happens before hash check, measurable with sufficient samples

⚠️ **No HTTPS in development:** `COOKIE_SECURE=false` allowed, development cookies vulnerable to network sniffing

⚠️ **Very long-lived sessions (365 days):** Much longer than industry standard (30-90 days for sensitive apps), increases risk

⚠️ **No device fingerprinting:** User-Agent stored but not validated, stolen cookie usable from any device/location

⚠️ **AuthToken attempts race condition:** Concurrent requests could bypass 5-attempt limit (low probability)

⚠️ **No password complexity requirements:** Only length enforced (10-128 chars per docs)

⚠️ **Account lockout per account, not per IP:** Attacker can lock victim's account from distributed sources

⚠️ **No 2FA/MFA:** Only password authentication

⚠️ **Email in plaintext in DB:** GDPR/privacy concern if DB leaked (normalized lowercase prevents rainbow tables but doesn't hide identity)

### 5.5 Common Security Principles

Both platforms follow security best practices:
- Passwords hashed with strong algorithms
- Sessions use cryptographically secure tokens
- Tokens hashed before DB storage (prevents session hijack from DB dump)
- HttpOnly cookies (XSS cannot steal sessions)
- CSRF protection via Origin header
- Rate limiting on authentication endpoints
- SQL injection prevented by parameterized queries
- Password rehash on all sessions after password change

---

## 6. Integration Challenges

### 6.1 Critical Blockers

1. **ID Type Incompatibility**
   - Endemion: INTEGER (4-8 bytes sequential)
   - Life: UUID (16 bytes random)
   - **Impact:** Cannot map users between systems without ID translation layer
   - **Solution:** OpenID Connect `sub` claim becomes universal ID

2. **Password Hash Incompatibility**
   - Endemion: PBKDF2-SHA256, 100k iterations
   - Life: scrypt, N=32768
   - **Impact:** Cannot migrate passwords directly, users would need to reset
   - **Solution:** IdP handles authentication, platforms trust IdP tokens

3. **Session Mechanism Incompatibility**
   - Different cookie names, TTLs, token formats
   - **Impact:** Users cannot stay logged in across both sites simultaneously
   - **Solution:** OpenID Connect SSO with per-site sessions federated to IdP

4. **Guest Progress in Life**
   - Life supports anonymous gameplay before registration
   - Endemion has no guest concept
   - **Impact:** Life's guest→account transfer logic must integrate with IdP registration
   - **Solution:** IdP registration triggers Life's transfer API with guest token

### 6.2 Data Conflict Scenarios

**Email Conflicts:**
- User registers on Endemion as `user@example.com`
- Same person registers on Life as `user@example.com`
- **Resolution:** IdP email is source of truth; during migration, detect conflicts and prompt user to claim account on one platform

**Username Conflicts:**
- Endemion has usernames (3-24 chars, alphanumeric + underscore)
- Life has no usernames yet
- **Resolution:** IdP creates username namespace; Endemion profiles migrate to IdP; Life adopts username from IdP on account creation

**Avatar Conflicts:**
- Endemion has avatar uploads + generated avatars (6 colors)
- Life has no avatars yet
- **Resolution:** IdP stores avatar_url; Endemion profile images migrate to IdP storage; Life displays IdP avatar

### 6.3 Deployment Constraints

**Shared VPS Resources:**
- 1 CPU, 2GB RAM total
- Running: Endemion (Node.js + SQLite), Life (Postgres + Redis + NestJS + Next.js + Nginx)
- Adding: auth.endemion.online (new service)
- **Impact:** Must choose lightweight IdP (not Keycloak at 1GB+ RAM)

**Zero-Downtime Requirement:**
- Both sites in production
- No evidence of real users yet (Life deployed 2026-11-03, SMTP not configured)
- But guest sessions exist (Stage 01 compatibility preserved)
- **Impact:** Migration must preserve existing sessions during transition

**Caddy Integration:**
- Existing Caddyfile routes `life.{$SITE_DOMAIN}` to Life's nginx
- **Impact:** Add `auth.{$SITE_DOMAIN}` route to IdP service

### 6.4 Technical Debt

**Endemion:**
- No email verification (password reset is only proof)
- Username generated from email, may have conflicts
- 19 tables reference users.id (migration complexity)
- ENDEMION ID concept partially implemented (profiles exist, but no cross-site integration)

**Endemion Life:**
- No username/avatar/profile system yet
- SMTP not configured (email verification unused)
- No roles/bans/moderation system
- Only 2 migrations (schema may change)

**Both:**
- No existing OIDC libraries installed
- Custom session systems deeply integrated
- No shared user concept between platforms

---

## 7. Existing User Data

### 7.1 Endemion

**Deployed:** Active since October 2024

**Evidence of Users:**
- Migrations include 16 schema updates
- Production database exists at `/opt/endemion/data/endemion.sqlite`
- Recent commits show platform features (profiles, achievements, community, arena)
- Memory notes mention deploy procedures and backups

**Estimated Scale:** Unknown (no user count visible in audit)

**User Data to Preserve:**
- User accounts (`users` table)
- Profiles (`user_profiles`: username, bio, avatar)
- Reading progress (`library`, `positions`)
- Community content (`reviews`, `comments`, `threads`, `collections`)
- Social (`follows`, `votes`, `achievements`)
- Audit trail (`audit_log`, `moderation_actions`)

**Migration Complexity:** HIGH (19 tables with FK to users.id)

### 7.2 Endemion Life

**Deployed:** 2026-11-03 (3 days ago)

**Evidence of Users:**
- STAGE_01_5_REPORT line 119: "SMTP не настроен" (SMTP not configured)
- Email verification codes stored in `.mail-outbox/` (file driver, development mode)
- Migration 20261102180000 preserves Stage 01 guest sessions

**Estimated Scale:** Very low (likely test accounts only)

**User Data to Preserve:**
- Guest players (Players without Account)
- Game progress (`lives`, `life_snapshots`, `history_entries`, `game_actions`)
- Sessions (preserve during migration)

**Migration Complexity:** MEDIUM (guest→account transfer already implemented, 6 tables with FK)

### 7.3 Migration Priority

1. **Life Migration:** EASIER, fewer users, guest system compatible with "account creation at IdP"
2. **Endemion Migration:** HARDER, more users, complex profile system, 19 FK tables

**Recommended Approach:**
1. Deploy auth.endemion.online (IdP)
2. Integrate Life first (simpler, register flow becomes "create IdP account + link to guest")
3. Integrate Endemion second (preserve existing accounts, require login at IdP, link accounts)
4. Provide migration tool for users to claim their account on the other platform

---

## 8. Technology Stack Summary

### 8.1 Endemion

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | 26.13.0 |
| Package Manager | npm | 11.20.0 |
| Database | SQLite (WAL mode) | Built-in |
| ORM | Custom D1-compatible adapter | - |
| Frontend | Vanilla JS (ES modules) | - |
| CSS | Vanilla CSS (CSS variables) | - |
| Fonts | Unbounded, Manrope | Variable |
| Deployment | Docker 29.9.2 + Caddy 2 | - |
| Testing | Node test runner, Playwright | 1.64.1 |
| Linting | ESLint | 10 |
| TypeScript | Type checking only (JSDoc) | 7.0.2 |

**No Build Step:** Files served directly from `public/`

**Cloudflare Compatibility:** Same code runs on Workers with D1

### 8.2 Endemion Life

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | 24+ |
| Package Manager | pnpm | 12.16.1 |
| Workspace | pnpm workspaces | - |
| Backend | NestJS | 12.3.2 |
| Frontend | Next.js (App Router) | 16.4.4 |
| React | React | 19.3.0 |
| Database | PostgreSQL | 18 (alpine) |
| ORM | Prisma | 7.10.1 |
| Cache | Redis | 8 (alpine) |
| Validation | Zod | 4.6.7 |
| CSS | Tailwind CSS | 4 |
| Fonts | Cormorant Garamond, Manrope | Google Fonts |
| Deployment | Docker Compose + Nginx | 1.27-alpine |
| Testing | Vitest, Playwright | 5.0.5, 1.64.1 |
| Linting | ESLint | 10 |
| TypeScript | Full TypeScript | 6.0.3 |

**Monorepo Structure:**
- `apps/api` (NestJS backend)
- `apps/web` (Next.js frontend)
- `packages/database` (Prisma client)
- `packages/game-core` (game logic)
- `packages/shared` (Zod schemas, constants)
- `packages/ui` (shared React components)

### 8.3 OIDC Library Recommendations

**Search Result:** No OIDC libraries currently installed in either project

**Options for Identity Provider:**

1. **node-oidc-provider** (panva/node-oidc-provider)
   - Latest: 9.13.3
   - Lightweight, flexible
   - Express/Koa/Fastify adapters
   - Good for custom deployments

2. **oauth4webapi** (panva/oauth4webapi)
   - Latest: 3.8.8
   - OAuth 2.0 client
   - No server implementation

3. **Keycloak**
   - Full-featured IdP
   - **REJECTED:** ~1GB RAM minimum (VPS only has 2GB total)

4. **Ory Hydra**
   - Lightweight OAuth2/OIDC server
   - Go-based (~50MB RAM)
   - **VIABLE:** Resource-efficient

**Recommended:** `node-oidc-provider` or Ory Hydra for resource-constrained VPS

---

## 9. Production Infrastructure

### 9.1 VPS Specifications

- **IP:** 185.175.156.196
- **CPU:** 1 core (shared)
- **RAM:** 2GB total
- **OS:** Linux (likely Ubuntu/Debian, Docker-compatible)
- **SSH:** `ssh -i ~/.ssh/endemion_vps root@185.175.156.196`

### 9.2 Current Services

**Endemion** (`/opt/endemion`):
- Docker Compose stack: app + caddy
- Port 80/443 (Caddy serves both sites)
- SQLite database: `/opt/endemion/data/endemion.sqlite`
- Backups: local `data/backups/` + S3 bucket `endemio`

**Endemion Life** (`/opt/endemion-life`):
- Docker Compose stack: postgres + redis + migrate + api + web + nginx
- No public ports (behind Caddy)
- PostgreSQL: internal network only
- Backups: planned (backup service exists)

**Caddy** (main site container):
- Reverse proxy for both sites
- Automatic HTTPS (Let's Encrypt)
- Routes:
  - `{$SITE_DOMAIN}` → endemion app:3000
  - `life.{$SITE_DOMAIN}` → endemion-life-nginx:80 (on network `endemion_default`)

### 9.3 DNS Configuration

**Registrar:** spaceweb.ru

**Records:**
- `endemion.online` → A → 185.175.156.196
- `www.endemion.online` → CNAME → endemion.online (Caddy redirects to apex)
- `life.endemion.online` → A → 185.175.156.196 (deployed 2026-11-03)

**Required Addition:**
- `auth.endemion.online` → A → 185.175.156.196

### 9.4 Deployment Procedures

**Endemion:**
```bash
# On VPS:
cd /opt/endemion
docker compose exec -T app node server/backup.mjs   # Backup DB
git pull --ff-only
docker compose up -d --build
```

**Endemion Life:**
```bash
# Build images locally (VPS has limited resources):
docker compose -f infrastructure/docker-compose.prod.yml \
  --env-file infrastructure/env.production.example build

# Transfer images:
docker save endemion-life-api endemion-life-web | gzip | \
  ssh -i ~/.ssh/endemion_vps root@185.175.156.196 'gunzip | docker load'

# Transfer code:
git bundle create /tmp/bundle.git main
scp /tmp/bundle.git root@185.175.156.196:/opt/endemion-life/
ssh root@185.175.156.196 'cd /opt/endemion-life && git pull /opt/endemion-life/bundle.git'

# On VPS:
cd /opt/endemion-life
docker compose exec -T postgres pg_dump ... > backup.sql   # Backup DB
docker compose -f infrastructure/docker-compose.prod.yml \
  -f infrastructure/docker-compose.behind-proxy.yml \
  --env-file .env up -d --no-build
```

**Caddy Reload Pitfall:** Caddyfile is bind-mounted as single file; after `git pull`, running container sees old inode. Must copy new file:
```bash
docker cp Caddyfile endemion-caddy-1:/tmp/Caddyfile.new
docker exec endemion-caddy-1 caddy validate --config /tmp/Caddyfile.new
docker exec endemion-caddy-1 caddy reload --config /tmp/Caddyfile.new
```

### 9.5 Resource Constraints

**Current Usage (estimated):**
- Endemion app: ~100MB RAM (Node.js + SQLite)
- Caddy: ~20MB RAM
- Life postgres: ~50MB RAM (minimal dataset)
- Life redis: ~20MB RAM (128MB limit, LRU eviction)
- Life api: ~150MB RAM (NestJS)
- Life web: ~100MB RAM (Next.js)
- Life nginx: ~10MB RAM

**Total:** ~450MB / 2GB (22% utilization)

**Headroom for Auth Service:** ~1.5GB available

**Constraint:** Must choose lightweight IdP implementation

---

## 10. Recommendations

### 10.1 Unified Architecture Approach

**REQUIRED:** Centralized OpenID Connect Provider at auth.endemion.online

**Rationale:**
1. ID type incompatibility (INTEGER vs UUID) makes direct merge impossible
2. Password hash incompatibility requires either rehashing or delegating to IdP
3. Session mechanisms are fundamentally different
4. Both platforms have existing users (Endemion more mature, Life recently deployed)
5. Guest system in Life requires special handling

**OpenID Connect Benefits:**
- Industry-standard protocol (OAuth 2.0 + ID Token)
- Platforms trust IdP's `sub` claim as universal user ID
- IdP handles authentication, platforms handle authorization
- Existing sessions remain valid during migration
- Each platform keeps its own session cookies (federated to IdP)
- No password migration needed (IdP becomes password authority)

### 10.2 Identity Provider Selection

**Criteria:**
- Lightweight (< 500MB RAM)
- OIDC compliant
- Supports Authorization Code Flow + PKCE
- Customizable UI (match Endemion design)
- Self-hosted
- Well-maintained

**Option A: node-oidc-provider (RECOMMENDED)**

**Pros:**
- Lightweight Node.js implementation
- Highly customizable
- Same runtime as both platforms (Node.js)
- Can reuse SQLite or PostgreSQL
- Familiar JavaScript/TypeScript

**Cons:**
- Requires custom UI development
- More setup than turnkey solution

**Implementation:**
```
auth.endemion.online (Node.js + Express + node-oidc-provider)
├── Database: SQLite or PostgreSQL
├── Storage: Redis (optional, for codes/sessions)
├── UI: Custom HTML/CSS matching Endemion design
└── Docker: ~100MB RAM
```

**Option B: Ory Hydra**

**Pros:**
- Production-ready
- Lightweight (~50MB RAM)
- Excellent documentation

**Cons:**
- Go-based (different runtime)
- Requires separate login/consent app
- More complex architecture

**Decision:** **node-oidc-provider** recommended for resource efficiency and consistency with existing stack

### 10.3 Migration Strategy

**Phase 1: Deploy IdP (Week 1-2)**
1. Set up auth.endemion.online with node-oidc-provider
2. Implement login/register/reset UI matching Endemion design
3. Database: PostgreSQL (shared with Life) or SQLite
4. Register OAuth clients:
   - `endemion-web` (redirect: https://endemion.online/auth/callback)
   - `endemion-life-web` (redirect: https://life.endemion.online/auth/callback)
5. Test with dummy accounts

**Phase 2: Integrate Endemion Life (Week 3-4)**
1. Install `openid-client` in apps/api
2. Add OIDC routes: `/auth/login`, `/auth/callback`, `/auth/logout`
3. Modify guest registration:
   - "Создать аккаунт" → redirect to IdP register
   - On callback, create Account + link to guest Player + transfer lives
4. Modify login:
   - "Войти" → redirect to IdP login
   - On callback, create session linked to IdP `sub`
5. Preserve existing guest sessions (no breaking changes)
6. Test guest→account flow

**Phase 3: Migrate Endemion Users (Week 5-8)**
1. Add OIDC client to Endemion
2. Batch import existing users to IdP:
   - Preserve emails, usernames, avatars
   - **Cannot migrate passwords** (PBKDF2 → scrypt incompatible)
   - Mark accounts as "password reset required"
3. On first login, redirect to IdP:
   - If account exists in IdP: normal login
   - If not: "This email exists, reset password to continue"
4. Link Endemion user.id to IdP `sub` in new table `oidc_links`
5. Gradually migrate sessions (dual auth during transition)

**Phase 4: Cross-Platform Features (Week 9-12)**
1. IdP becomes source of truth for:
   - Email (verified at IdP)
   - Username (unified namespace)
   - Avatar (stored at IdP or CDN)
2. Life adopts username/avatar from IdP
3. Profile page at auth.endemion.online shows:
   - ENDEMION ID
   - Linked accounts (Endemion, Endemion Life)
   - Unified logout
4. Implement SSO:
   - User logs in to Endemion → auto-login to Life (if visited)
   - User logs in to Life → auto-login to Endemion (if visited)

**Phase 5: Cleanup (Week 13+)**
1. Remove password reset from platforms (delegate to IdP)
2. Remove local registration (redirect to IdP)
3. Archive old auth tables (preserve for rollback)
4. Monitor for edge cases

### 10.4 Database Design for IdP

**Recommended:** PostgreSQL (shared with Life infrastructure)

```sql
CREATE TABLE oidc_accounts (
  sub UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- OIDC subject claim
  email VARCHAR(254) UNIQUE NOT NULL,
  email_verified BOOLEAN DEFAULT FALSE,
  username VARCHAR(24) UNIQUE NOT NULL,            -- Unified namespace
  display_name VARCHAR(40),
  avatar_url TEXT,
  password_hash VARCHAR(255),                      -- scrypt (same as Life)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE oidc_sessions (
  sid VARCHAR(64) PRIMARY KEY,
  account_sub UUID REFERENCES oidc_accounts(sub) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  data JSONB                                       -- OIDC provider session state
);

CREATE TABLE oidc_codes (
  code_hash CHAR(64) PRIMARY KEY,                  -- SHA-256 of authorization code
  account_sub UUID REFERENCES oidc_accounts(sub) ON DELETE CASCADE,
  client_id VARCHAR(100),
  redirect_uri TEXT,
  scope TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE platform_links (
  account_sub UUID REFERENCES oidc_accounts(sub) ON DELETE CASCADE,
  platform VARCHAR(20),                            -- 'endemion' | 'endemion_life'
  platform_user_id TEXT,                           -- Endemion: users.id (INTEGER), Life: players.id (UUID)
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (account_sub, platform)
);
```

**Migration Table (Endemion users → IdP):**
```sql
CREATE TABLE endemion_migrations (
  endemion_user_id INTEGER PRIMARY KEY,
  idp_account_sub UUID REFERENCES oidc_accounts(sub),
  migrated_at TIMESTAMPTZ DEFAULT NOW(),
  password_reset_required BOOLEAN DEFAULT TRUE
);
```

### 10.5 Security Recommendations

**For IdP:**
1. Enforce email verification before OAuth consent
2. Implement rate limiting on token endpoint (prevent code replay)
3. Use PKCE with S256 (required for public clients)
4. Short-lived access tokens (5-15 minutes)
5. Refresh tokens with rotation (detect token theft)
6. Audit log all authentication events
7. Implement account lockout after failed logins
8. Optional: Add 2FA/TOTP support

**For Platforms:**
1. Validate ID tokens (signature, issuer, audience, expiration)
2. Check `nonce` to prevent replay attacks
3. Verify `state` parameter to prevent CSRF
4. Do NOT trust client-side ID tokens (validate on backend)
5. Implement token refresh flow (handle expired tokens)
6. Revoke platform sessions when IdP session revoked

**Infrastructure:**
1. HTTPS everywhere (Caddy handles this)
2. Secure cookie attributes (already implemented)
3. CSP headers (already implemented)
4. Regular security audits
5. Keep dependencies updated
6. Monitor for suspicious login patterns

### 10.6 User Communication Plan

**Before Migration:**
1. Announce unified authentication 2 weeks in advance
2. Explain benefits (one account, seamless login)
3. Warn Endemion users: "Password reset required" (cannot migrate PBKDF2→scrypt)
4. Assure data preservation (no reading progress lost)

**During Migration:**
1. Dual auth period (old sessions remain valid)
2. "Migrate Now" banner on both sites
3. Email to all users with migration instructions
4. Support channel for migration issues

**After Migration:**
1. Celebrate unified ENDEMION ID
2. Showcase cross-platform features
3. Gather feedback
4. Announce future integrations

### 10.7 Rollback Plan

**If IdP Integration Fails:**
1. Keep old auth endpoints active during transition
2. Feature flags: `OIDC_ENABLED=false` → fall back to local auth
3. Database backups before each migration step
4. Platform-specific rollback:
   - Endemion: restore SQLite from backup
   - Life: restore PostgreSQL from pg_dump
5. Caddy config rollback: remove auth.endemion.online route

**Critical:** Do not delete old auth tables until migration stable for 30+ days

### 10.8 Resource Allocation

**auth.endemion.online Service:**
```yaml
services:
  auth:
    build: ./auth
    environment:
      DATABASE_URL: postgresql://...
      REDIS_URL: redis://...
      SESSION_SECRET: <random>
      COOKIE_SECRET: <random>
    deploy:
      resources:
        limits:
          memory: 200M
        reservations:
          memory: 100M
```

**Updated Caddyfile:**
```
auth.{$SITE_DOMAIN} {
  encode zstd gzip
  reverse_proxy endemion-auth:3000
}
```

**Total VPS Usage After Auth Deployment:**
- Current: ~450MB
- Auth service: ~100MB
- **New Total:** ~550MB / 2GB (27% utilization)

**Safe Margin:** 1.4GB free for traffic spikes

---

## Conclusion

Both Endemion and Endemion Life have **secure, well-implemented authentication systems** that are fundamentally incompatible due to different ID types, password hashing algorithms, and session mechanisms.

**Direct database merge is not feasible.** The only viable path to unified authentication is a **centralized OpenID Connect Provider** at auth.endemion.online.

The recommended approach:
1. Deploy lightweight IdP (node-oidc-provider on shared PostgreSQL)
2. Integrate Life first (simpler, fewer users, guest system compatible)
3. Migrate Endemion users (require password reset due to hash incompatibility)
4. Implement SSO and cross-platform features
5. Maintain dual auth during transition for safety

**Timeline:** 12-13 weeks for full integration  
**Risk Level:** MEDIUM (well-defined protocol, production-tested implementations available)  
**Rollback Safety:** HIGH (old auth remains active during transition)

---

**Next Steps:**
1. Review and approve architecture
2. Select IdP implementation (node-oidc-provider recommended)
3. Set up development environment for auth.endemion.online
4. Begin Phase 1: IdP deployment

**Questions for Owner:**
1. Approve password reset requirement for Endemion users?
2. Username conflict resolution strategy (first-come-first-served vs manual merge)?
3. Avatar migration: IdP storage or CDN (S3)?
4. Timeline acceptable (3 months)?
5. Budget for external services (SMTP, S3, Sentry)?
