-- Ссылка «это был не я» из письма о новом входе. В базе только SHA-256 токена, живёт сутки
CREATE TABLE login_alerts (
  token_hash TEXT PRIMARY KEY,
  account_sub TEXT NOT NULL REFERENCES accounts(sub) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX login_alerts_account ON login_alerts (account_sub);
