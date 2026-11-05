-- Ключи доступа (WebAuthn). Публичный ключ хранится как есть, приватный остаётся на устройстве.
-- Счётчик подписи не даёт принять старый ответ второй раз

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  account_sub TEXT NOT NULL REFERENCES accounts(sub) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);
CREATE INDEX passkeys_account ON passkeys (account_sub);

-- Одноразовый challenge. Живёт 5 минут и принимается только тем браузером, который его запросил
CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  account_sub TEXT,
  interaction_uid TEXT,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
