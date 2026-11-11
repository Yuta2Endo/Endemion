-- Robokassa: заказы, кошелёк crystals (общий баланс по endemion_sub) и ledger транзакций.
-- InvId = orders.inv_id (автоинкремент). Начисление только по серверному уведомлению Result URL.

CREATE TABLE orders (
  inv_id INTEGER PRIMARY KEY AUTOINCREMENT,
  endemion_sub TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  item_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),         -- OutSum в рублях (ожидаемая сумма)
  crystals INTEGER NOT NULL CHECK (crystals >= 0),    -- сколько валюты начислить
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'canceled', 'failed')),
  robokassa_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paid_at TEXT
);

CREATE INDEX idx_orders_endemion_sub ON orders(endemion_sub);
CREATE INDEX idx_orders_status ON orders(status, created_at);

CREATE TABLE wallets (
  endemion_sub TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE wallet_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endemion_sub TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,                 -- например: robokassa:inv_id:123
  ref_inv_id INTEGER REFERENCES orders(inv_id),
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(type, reason)
);

CREATE INDEX idx_wallet_tx_sub ON wallet_transactions(endemion_sub, created_at);
CREATE INDEX idx_wallet_tx_ref ON wallet_transactions(ref_inv_id);