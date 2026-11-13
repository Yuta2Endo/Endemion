# ROBOKASSA — Test Data Cleanup Final Report

**Status:** `CLEANUP COMPLETED`  
**Date:** 2026-11-12  
**Mode:** Approved cleanup executed on production DB (compensating debit only). **No handler/config/deploy changes.**  
**Target (production):** `185.175.156.196`, `/opt/endemion`, container `app`, DB `/app/data/endemion.sqlite` (SQLite, WAL) — **verified live** before and after execution.  
**Repo HEAD (production):** `27bb191 Set Robokassa merchant login in env example` (`site-improve`, detached checkout on server as previously noted).

## 1. Audit findings (summary)

Source audit: `docs/ROBOKASSA_TEST_DATA_CLEANUP_AUDIT.md` (`AUDIT COMPLETED` / `AWAITING OWNER APPROVAL`, read-only).

- **Totals (pre-cleanup):** 1 wallet, 100 crystals total; 4 orders (`#1–#3 pending`, `#4 paid`); 1 wallet tx (`credit +100`, `robokassa:inv_id:4`); identified test credits **1**, real **0**, unknown **0**.
- **Order #4** (`88fb301b-****-****-****-18a86567c12c`, `gems_100`, 100 ₽ / 100 crystals, `paid` `2026-11-11T23:23:42.110Z`): **positively test-only** — stored Result `orders.robokassa_payload` and `wallet_transactions.meta_json` contain `"IsTest":"1"` with matching `InvId`/`OutSum`/`Shp_uid`/`Shp_item`. Corresponding credit tx `id=1`.
- **Orders #1–#3** (same user/item/amount): `pending`, `paid_at`/`robokassa_payload` `null`, **no wallet txs/credits** — no wallet impact.
- **Schema/semantics verified:** `wallet_transactions.type IN ('credit','debit')`, `amount > 0`, `UNIQUE(type,reason)`; `wallets.balance >= 0`. Compensating `debit` row supported without schema/handler changes.

## 2. Approved cleanup scope

**Explicit owner approvals:**
1. **Order #4 — compensating debit (approved: YES):** remove 100 test crystals, keep history. Keep `orders#4` as `paid` and original credit tx intact; add compensating `debit 100`, `reason='test_cleanup:robokassa:inv_id:4'`, `ref_inv_id=4`; adjust affected wallet balance accordingly.
2. **Orders #1–#3 — KEEP PENDING (approved):** no status/record changes.

**Out of scope / not performed:** no `DELETE` of orders/txs, no status changes to `#1–#3`, no schema/migration changes, no handler/endpoint/config/`IsTest` changes, no deploy.

## 3. Backup details (consistent, WAL-safe)

Created immediately before execution using SQLite `VACUUM INTO` on the live runtime DB (not a blind file copy):

| Field | Value |
|---|---|
| Source DB | `/app/data/endemion.sqlite` (live, verified runtime) |
| Backup path | `/app/data/backups/endemion-pre-cleanup-robokassa4-2026-11-12T00-25-23Z.sqlite` |
| Timestamp (UTC) | `2026-11-12T00:25:23Z` (path timestamp) |
| Size | **125M** |
| Integrity | `PRAGMA integrity_check = ok` (verified on backup) |
| Backup contains (pre-cleanup, verified) | `orders#4 status=paid crystals=100`; wallet `88fb301b-****-****-****-18a86567c12c` `balance=100` |

Backup preserved in-place on production. **No DB backup or secrets committed to git.**

## 4. Pre-execution revalidation (live, passed)

Revalidated immediately before mutation (no drift from audit snapshot):
- `orders#4`: `status='paid'`, `crystals=100`, `endemion_sub=88fb301b-d482-40bd-bcd5-18a86567c12c`, stored payload present (`IsTest=1`).
- Original tx: `id=1 type=credit amount=100 reason='robokassa:inv_id:4' ref_inv_id=4` — present/intact.
- Wallet `88fb301b-****-****-****-18a86567c12c`: `balance=100`.
- No existing compensation: no `debit` with `reason='test_cleanup:robokassa:inv_id:4'`.
- No other txs for wallet (`otherTxCount=0`), total wallets `1`.
- Precondition `balance - 100 >= 0` satisfied.

## 5. Execution (atomic)

- **Transaction:** `BEGIN IMMEDIATE` → precondition checks → insert compensating debit → update wallet → `COMMIT` (single atomic transaction). On any failure path: `ROLLBACK`.
- **Execution time (recorded):** `2026-11-12T00:25:51.213Z`
- **Affected-row counts:** `INSERT wallet_transactions = 1`, `UPDATE wallets = 1`.

**Operations applied (approved only):**
1. `INSERT INTO wallet_transactions (endemion_sub,type,amount,reason,ref_inv_id,meta_json,created_at)` → `('88fb301b-d482-40bd-bcd5-18a86567c12c','debit',100,'test_cleanup:robokassa:inv_id:4',4,'{"cleanup":"test_cleanup:robokassa:inv_id:4","inv_id":4,"approved":true}','2026-11-12T00:25:51.213Z')`
2. `UPDATE wallets SET balance = balance - 100, updated_at = '2026-11-12T00:25:51.213Z' WHERE endemion_sub='88fb301b-d482-40bd-bcd5-18a86567c12c' AND balance >= 100`

**Idempotency:** compensation keyed by `reason='test_cleanup:robokassa:inv_id:4'` with schema `UNIQUE(type,reason)` and pre-execution existence/precondition checks (re-run would be blocked by existing debit / preconditions).

## 6. Exact records affected — before/after

### 6.1 Wallet (affected)
| endemion_sub (masked) | Field | Before | After |
|---|---|---:|---:|
| `88fb301b-****-****-****-18a86567c12c` | `balance` | 100 | **0** |
| | `updated_at` | `2026-11-11T23:23:42.110Z` | **`2026-11-12T00:25:51.213Z`** |

No other wallets exist/changed (total wallets: 1).

### 6.2 Ledger (wallet_transactions)
| id | endemion_sub (masked) | type | amount | reason | ref_inv_id | created_at | State |
|---:|---|---|---:|---|---:|---|---|
| 1 | `88fb301b-****-****-****-18a86567c12c` | credit | 100 | `robokassa:inv_id:4` | 4 | `2026-11-11T23:23:42.111Z` | **Intact / unchanged** (original credit preserved) |
| 2 | `88fb301b-****-****-****-18a86567c12c` | debit | 100 | `test_cleanup:robokassa:inv_id:4` | 4 | `2026-11-12T00:25:51.213Z` | **Added** (compensating) |

Ledger sum (affected wallet): credits `+100` − debits `100` = **0**. No other transactions.

### 6.3 Orders
| inv_id | endemion_sub (masked) | item_id | amount | crystals | status | paid_at | payload | State |
|---:|---|---|---:|---:|---|---|---|---|
| 1 | `88fb301b-****-****-****-18a86567c12c` | `gems_100` | 100 | 100 | `pending` | — | none | **Unchanged** (kept pending, approved) |
| 2 | `88fb301b-****-****-****-18a86567c12c` | `gems_100` | 100 | 100 | `pending` | — | none | **Unchanged** (kept pending, approved) |
| 3 | `88fb301b-****-****-****-18a86567c12c` | `gems_100` | 100 | 100 | `pending` | — | none | **Unchanged** (kept pending, approved) |
| 4 | `88fb301b-****-****-****-18a86567c12c` | `gems_100` | 100 | 100 | `paid` | `2026-11-11T23:23:42.110Z` | present (`IsTest=1`) | **Unchanged** (history preserved) |

## 7. Post-cleanup verification (passed)

Verified live after commit:

| Check | Result |
|---|---|
| Orders `#1–#3` remain `pending`, no payload | **PASS** (unchanged) |
| Order `#4` remains `paid` with payload/history | **PASS** (`paid`, `2026-11-11T23:23:42.110Z`, payload present) |
| Original credit tx `id=1` intact | **PASS** (`credit 100 robokassa:inv_id:4` ref 4) |
| Compensating debit exists exactly once | **PASS** (`id=2 debit 100 test_cleanup:robokassa:inv_id:4` ref 4) |
| No duplicate compensation / no duplicate credits | **PASS** (2 txs total: 1 credit, 1 debit) |
| Wallet balance matches ledger sum | **PASS** (`balance=0`, `SUM(credit)-SUM(debit)=0`) |
| No unrelated wallets/txs/orders changed | **PASS** (1 wallet, 2 txs, 4 orders total; only approved debit+balance update applied) |
| Real/legitimate records unaffected | **PASS** (no real transactions existed; none modified) |
| `ROBOKASSA_IS_TEST` / handlers / endpoints / config | **Unchanged** by this cleanup (DB-only approved operation; no code/config/deploy) |

## 8. Remaining records / notes

- **Orders `#1–#3`:** remain `pending` per approval (no credit, no payload). Known risk from audit (unchanged): current Result handler rejects non-`pending` orders with 400; late valid notification handling for canceled/non-pending not made safe in this task (not applicable while kept pending).
- **Unknown records:** none.
- **Real payments affected:** none.

## 9. Git status

- Local workspace: `G:\III\Project\Endemion`, branch `site-improve` (as of audit context).
- Cleanup documentation present locally (uncommitted at time of reporting): `docs/ROBOKASSA_TEST_DATA_CLEANUP_AUDIT.md`, `docs/ROBOKASSA_TEST_DATA_CLEANUP_FINAL_REPORT.md`.
- **No commit/push performed** as part of cleanup; no secrets or DB backups added to git. (Commit/push only if explicitly authorized.)

## 10. Blockers

- **None.** Approved scope (order #4 compensating debit) completed and independently verified on the live production database. Orders #1–#3 left `pending` as requested.

**Final status:** `CLEANUP COMPLETED` — production DB modified as approved (atomic, backed up, verified) with audit history preserved and no unrelated/handler/config changes.
