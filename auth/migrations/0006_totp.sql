-- Двухфакторная защита: секрет TOTP (зашифрован) и одноразовые запасные коды (только SHA-256)

CREATE TABLE totp (
  account_sub TEXT PRIMARY KEY REFERENCES accounts(sub) ON DELETE CASCADE,
  -- iv.tag.ciphertext, ключ — от AUTH_COOKIE_KEYS. Секрет нужен, чтобы посчитать код, поэтому это не хеш
  secret TEXT NOT NULL,
  -- Номер шага (30 секунд) последнего принятого кода: тот же код второй раз не принимается
  last_step INTEGER NOT NULL DEFAULT 0,
  enabled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Секрет, который ещё не подтверждён кодом из приложения. В браузер не попадает
CREATE TABLE totp_setup (
  account_sub TEXT PRIMARY KEY REFERENCES accounts(sub) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Пароль уже принят, ждём код. Запись живёт только вместе со страницей входа
CREATE TABLE login_challenges (
  interaction_uid TEXT PRIMARY KEY,
  account_sub TEXT NOT NULL,
  amr TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE totp_backup (
  account_sub TEXT NOT NULL REFERENCES accounts(sub) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  PRIMARY KEY (account_sub, code_hash)
);
