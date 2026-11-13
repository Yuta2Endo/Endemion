# ROBOKASSA — Test Data Cleanup Audit (Read-only)

**Status:** `AUDIT COMPLETED` / `AWAITING OWNER APPROVAL`  
**Date:** 2026-11-12  
**Mode:** Read-only audit. **No database modifications performed.**  
**Target (production):** `185.175.156.196`, `/opt/endemion`, container `app`, DB `/app/data/endemion.sqlite` (SQLite, WAL) — **verified live** (queried via `docker compose exec app node` / `node:sqlite`).  
**Repo HEAD (production):** `27bb191 Set Robokassa merchant login in env example` (branch state `site-improve`, detached checkout on server as previously noted).

## 1. Scope and objective

Audit test-only Robokassa crystal credits/orders and prepare a dry-run plan to:
1. Reverse **only** the identified test credit from order `#4` (compensating debit, preserving history).
2. Review unfinished test orders `#1–#3` (`pending`) for safe non-destructive handling.
3. Preserve real payments, legitimate balances, audit history, and existing Robokassa handlers/endpoints.

**No `DELETE/UPDATE/INSERT/migration/wallet mutation` executed.**

## 2. Implementation inspected (read-only)

| Area | File(s) | Notes |
|---|---|---|
| Catalog, signatures, payment URL | `functions/_lib/robokassa.js` | Fixed catalog `gems_100` 100₽/100, `gems_500` 450₽/500, `gems_1000` 850₽/1000. `startSignature`: `MerchantLogin:OutSum(fixed 2dp):InvId:Password1[:Shp_* alpha]` (SHA256/MD5 upper-hex). `resultSignature`: `OutSum(as received):InvId:Password2[:Shp_*]`. `buildPaymentUrl` sets `MerchantLogin, OutSum, InvId, Description, SignatureValue, IsTest, Shp_uid, Shp_item`. |
| Order creation (pre-payment) | `functions/api/robokassa/create.js` | `POST`, requires session; `endemion_sub` taken **from server session** (`user.endemionSub`, 403 if missing). Validates `itemId` against catalog, requires `ROBOKASSA_MERCHANT_LOGIN`+`PASSWORD_1`. Inserts `orders(..., status='pending') RETURNING inv_id`, returns signed URL. **Does not store IsTest on order at creation.** |
| Result URL (crediting) | `functions/api/robokassa/result.js` | `POST/GET`. Verifies `SignatureValue` with `ROBOKASSA_PASSWORD_2` over received `OutSum`+`InvId`+`Shp_*`. Validates fields, loads order, idempotent if `paid`. Rejects if not `pending`. Checks `Shp_uid==order.endemion_sub`, `Shp_item==order.item_id`, `OutSum` numeric ≈ `order.amount` == catalog amount, `crystals` == catalog. Claim: `UPDATE orders SET status='paid', robokassa_payload=?, paid_at=? WHERE inv_id=? AND status='pending'` (must affect 1). Then `batch([UPSERT wallets balance += crystals, INSERT wallet_transactions credit reason robokassa:inv_id:<N> ref_inv_id payload])`. UNIQUE `(type,reason)` guards duplicate credit; constraint conflict after claim -> returns `OK`. Responds `OK<InvId>` on success/idempotent-paid. **Stores full received params as `orders.robokassa_payload` and `wallet_transactions.meta_json`.** |
| Routing | `src/worker.js` | `/api/robokassa/result` → result handler, `/api/robokassa/create` → create handler. |
| Middleware | `functions/api/_middleware.js` | CSRF/Origin check for mutating `/api/*` **exempted** for `/api/robokassa/result` (server-to-server). `/create` remains protected. |
| Env wiring | `server/index.mjs` | Passes `ROBOKASSA_MERCHANT_LOGIN/PASSWORD_1/PASSWORD_2/SIGNATURE_ALGO/IS_TEST` to app env. |
| Schema/migration | `migrations/0025_robokassa.sql` | `orders` (inv_id PK AI, endemion_sub, user_id, item_id, amount>0, crystals>=0, status in pending/paid/canceled/failed, robokassa_payload, timestamps), `wallets` (endemion_sub PK, balance>=0), `wallet_transactions` (type credit|debit, amount>0, reason, ref_inv_id, meta_json, **UNIQUE(type,reason)**). |
| Current config (reported/verified) | server env | `ROBOKASSA_IS_TEST=1`, `ROBOKASSA_SIGNATURE_ALGO=sha256`, `ROBOKASSA_MERCHANT_LOGIN=endemion`. |

**Ledger semantics (from implementation, not assumed):**
- `wallet_transactions.type`: `credit` or `debit` (schema CHECK). Credit path inserts `type='credit'`.
- `wallet_transactions.amount`: positive integer (CHECK > 0), direction indicated by `type`.
- `wallet_transactions.reason`: e.g. `robokassa:inv_id:<invId>` for Robokassa credits; unique per `(type,reason)`.
- `wallets.balance`: running balance (INTEGER >= 0, CHECK) updated by `balance = balance + <credited amount>` on credit upsert.
- No debit/refund/compensation code path exists in current implementation; schema **permits** `debit` rows and positive amounts, and `UNIQUE(type,reason)` allows a different reason than the original credit.

## 3. Live database snapshot (read-only, verified)

Queried at audit time from `/app/data/endemion.sqlite` (inside `app` container).

### 3.1 Totals
| Metric | Value |
|---|---|
| Wallet records | 1 |
| Wallets total balance | 100 crystals |
| Orders (all) | 4 (`#1–#3 pending`, `#4 paid`) |
| Wallet transactions (all) | 1 (`credit +100`, `robokassa:inv_id:4`) |
| Identified test transactions (evidence-backed) | 1 |
| Identified real transactions | 0 |
| Unknown transactions | 0 |

### 3.2 Orders `#1–#4`
| inv_id | endemion_sub (masked) | user_id | item_id | amount (RUB) | crystals | status | created_at | paid_at | robokassa_payload / evidence |
|---:|---|---:|---|---:|---:|---|---|---|---|
| 1 | `88fb301b-****-****-****-18a86567c12c` | 2 | `gems_100` | 100 | 100 | `pending` | `2026-11-11T23:12:16.187Z` | — | `null` (no Result URL notification recorded) |
| 2 | `88fb301b-****-****-****-18a86567c12c` | 2 | `gems_100` | 100 | 100 | `pending` | `2026-11-11T23:14:16.642Z` | — | `null` |
| 3 | `88fb301b-****-****-****-18a86567c12c` | 2 | `gems_100` | 100 | 100 | `pending` | `2026-11-11T23:19:54.892Z` | — | `null` |
| 4 | `88fb301b-****-****-****-18a86567c12c` | 2 | `gems_100` | 100 | 100 | `paid` | `2026-11-11T23:22:49.893Z` | `2026-11-11T23:23:42.110Z` | Stored Result payload includes **`"IsTest":"1"`**, matching `InvId`/`OutSum`/`Shp_uid`/`Shp_item`/signature fields (see evidence) |

### 3.3 Wallet(s)
| endemion_sub (masked) | balance | updated_at |
|---|---:|---|
| `88fb301b-****-****-****-18a86567c12c` | 100 | `2026-11-11T23:23:42.110Z` |

### 3.4 Ledger (wallet_transactions)
| id | endemion_sub (masked) | type | amount | reason | ref_inv_id | created_at | meta/evidence |
|---:|---|---|---:|---|---:|---|---|
| 1 | `88fb301b-****-****-****-18a86567c12c` | credit | 100 | `robokassa:inv_id:4` | 4 | `2026-11-11T23:23:42.111Z` | `meta_json` contains same stored notification incl. `"IsTest":"1"` |

**Ledger calculation (affected wallet):** credits `+100` (tx #1) − debits `0` = **100**. Matches `wallets.balance` (100). No other transactions for this or any wallet.

### 3.5 Duplicate / related notifications
- One `paid` order (`#4`), one credit tx (`#1`, `reason robokassa:inv_id:4`, unique key present). No duplicate ledger entries. No other `robokassa_payload` recorded.

## 4. Test-data classification and evidence

Classification rule applied (per-record evidence; current env mode **not** used as sole proof):

| Record | Classification | Evidence | Notes |
|---|---|---|---|
| Order #4 / tx #1 | **TEST-ONLY (candidate for reversal)** | `orders.robokassa_payload` and `wallet_transactions.meta_json` (stored Result URL notification actually processed) contain `"IsTest":"1"` with `InvId=4`, `OutSum=100`, `Shp_item=gems_100`, `Shp_uid` matching order; status `paid`; corresponding credit `+100`/`robokassa:inv_id:4`. Owner-confirmed successful test flow. | Positive, per-record evidence. |
| Orders #1–#3 | **UNPAID TEST ATTEMPTS (no credit)** — wallet impact **none** | `status=pending`, `paid_at=null`, `robokassa_payload=null`, no wallet transactions, no recorded confirmation. Created in same test session/window as #4 (same user/item/amount/config context). | No funds credited; see delayed-callback risk (sec. 6). Not classified as "real". |
| Any other order/wallet/tx | **none exist** | DB contains only #1–#4, 1 wallet, 1 tx. | — |

No records classified as real. No records classified `UNKNOWN` among credited transactions.

## 5. Dry-run — candidate operations (NO CHANGES MADE)

### 5.1 Candidate test orders / credits
| inv_id | endemion_sub (masked) | item_id | amount | crystals | status | test evidence | ledger tx |
|---:|---|---|---:|---:|---|---|---|
| 4 | `88fb301b-****-****-****-18a86567c12c` | `gems_100` | 100 | 100 | `paid` | Result payload `IsTest=1` (stored) | `id=1, credit +100, reason robokassa:inv_id:4, ref_inv_id=4` |

### 5.2 Affected wallets and proposed removal
| endemion_sub (masked) | current balance | identified test credits | crystals to remove | legitimate (non-test) balance | expected balance after approved cleanup |
|---|---:|---:|---:|---:|---:|
| `88fb301b-****-****-****-18a86567c12c` | 100 | 100 (tx #1, inv #4, IsTest=1) | **100** | 0 | **0** |

No other wallets affected.

### 5.3 Proposed operation — Order #4 (awaiting approval)
**Intent:** reverse test-only +100 while preserving payment/credit history (non-destructive to history).

- **Keep:** `orders#4` as `paid`; original credit tx `id=1` (`credit +100, robokassa:inv_id:4`) intact.
- **Add (proposed, not executed):** compensating ledger entry
  - `type = 'debit'` (schema-supported, `type IN ('credit','debit')`)
  - `amount = 100` (CHECK > 0)
  - `endemion_sub = 88fb301b-d482-40bd-bcd5-18a86567c12c` (same wallet)
  - `reason = 'test_cleanup:robokassa:inv_id:4'` (distinct from original credit; **UNIQUE(type,reason)** => idempotent vs re-run of same compensation)
  - `ref_inv_id = 4`
  - `meta_json` documenting audit/cleanup reference (non-secret)
- **Update (proposed):** `wallets.balance = balance - 100`, `updated_at = now` for that `endemion_sub`, **only if** resulting balance >= 0 and preconditions hold.
- **Do not:** delete order #4, delete tx #1, change schema/constraints/handlers/config.

**Schema support:** yes for a compensating debit row + balance adjustment (matches existing types/constraints). No new type invented.

**Preconditions to revalidate immediately before execution:** tx #1 still exists as credit +100 for inv 4; no other txs for wallet; wallet balance == 100; no compensation `debit` with `reason='test_cleanup:robokassa:inv_id:4'` exists; `balance - 100 >= 0`.

### 5.4 Proposed operation — Orders #1–#3 (awaiting approval)
**Intent:** keep history; mark conclusively-unpaid test attempts non-destructively only if safe.

- **Observed:** `pending`, no `robokassa_payload`, no `paid_at`, no wallet txs, no recorded confirmation/credit.
- **Proposed (if approved):** `UPDATE orders SET status='canceled' WHERE inv_id IN (1,2,3) AND status='pending' AND robokassa_payload IS NULL` (affected rows must be exactly 3). Status `canceled` **already exists** in schema — no new status invented.
- **Do not:** delete orders #1–#3.

## 6. Risks and blockers

| Item | Assessment |
|---|---|
| **Delayed Result URL for #1–#3 (RISK/BLOCKER for auto-cancel)** | Current handler behavior: loads order; if `status == 'paid'` -> `OK`; **if `status != 'pending'` -> returns `400 "bad request"`** (and does **not** credit). Therefore, if #1–#3 were set to `canceled`, a *late valid* payment notification for them would be **rejected (400) rather than credited or safely transitioned**. Existing handler does **not** explicitly support a safe `canceled -> paid` transition for a genuine late payment. Per instructions: **do not change handler in this cleanup task**; report as blocker/risk. Given #1–#3 are test attempts with no recorded confirmation and `IsTest=1` context, owner may accept this risk, but it must be an explicit, approved decision. |
| **Balance going negative** | Prevented by precondition (`100-100>=0`) and DB `CHECK (balance >= 0)`. |
| **Idempotency of compensation** | Achievable via `UNIQUE(type,reason)` for `debit` reason `test_cleanup:robokassa:inv_id:4` and/or existence check before insert (exact SQL to be defined at execution, atomically). |
| **Live state drift** | Any change to wallet/txs/orders since this audit (esp. wallet balance != 100, new txs, order statuses changed) => **STOP and request renewed approval**. |
| **DB path/access** | Live runtime DB verified as `/app/data/endemion.sqlite` (128MB) inside `app`; `/app/data/db.sqlite` exists but empty — must operate only on verified runtime DB with consistent mechanism (WAL-safe). |

**Blockers:** none preventing the audit; **conditional risk** attached to canceling #1–#3 (late-notification handling not safe-by-design in current handler). Compensation for #4 is schema-supported and low-risk given current snapshot (balance equals sole test credit).

## 7. Backup requirements (for any future approved execution)
- Create a **consistent** SQLite backup of `/app/data/endemion.sqlite` (WAL-aware; e.g. SQLite backup API / `VACUUM INTO` / equivalent consistent method) — **not** a blind file copy of a live DB.
- Preserve original DB; verify backup opens; record path, timestamp, size; do not overwrite existing backups.
- Reconfirm target is the live runtime DB immediately before backup/execution.

## 8. Expected outcome (if approved as proposed and snapshot unchanged)
- `orders#4`: remains `paid` (history preserved).
- Ledger: tx #1 `credit +100 robokassa:inv_id:4` remains; **one** compensating `debit -100 test_cleanup:robokassa:inv_id:4` added.
- Wallet `88fb301b-****-****-****-18a86567c12c`: **100 → 0** (equals ledger sum).
- `orders#1–#3`: remain in history; **optionally** `pending → canceled` only if owner approves accepting late-notification risk noted above.
- No other users/wallets/orders/txs changed. `ROBOKASSA_IS_TEST=1`. Handlers/config unchanged.

## 9. Verification plan (post-execution, if approved)
- Recount wallets/txs/orders; confirm exactly-approved affected rows.
- `SELECT balance` vs `SUM(credits)-SUM(debits)` per affected wallet — equal.
- Confirm tx #1 intact, exactly one compensation `debit` for `test_cleanup:robokassa:inv_id:4`, no duplicates.
- Confirm real/other records unchanged; orders #1–#4 history intact; #4 still `paid`.
- Confirm `ROBOKASSA_IS_TEST` still `1`, handlers/endpoints unmodified.

## 10. Approval gate

**STOP — no destructive database operation executed.** Awaiting explicit owner approval specifying:
1. Approve compensating debit for `order #4` (remove 100 test crystals from wallet `88fb301b-****-****-****-18a86567c12c`, keep #4 paid + original credit, add `debit 100 reason test_cleanup:robokassa:inv_id:4`), and/or
2. Approve handling of `orders #1–#3` (`pending` → `canceled`) acknowledging the late-notification risk in sec. 6, **or** keep them `pending`.

Execution may proceed **only** after explicit approval, with revalidation/consistent backup/atomic transaction/idempotency checks as specified.
