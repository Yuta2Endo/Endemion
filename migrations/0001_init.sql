-- Пользователи, сессии и защита от перебора паролей

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  -- pbkdf2$<итерации>$<соль base64>$<хеш base64>
  password_hash TEXT NOT NULL,
  -- Когда пользователь согласился с политикой конфиденциальности
  consent_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- В базе хранится только SHA-256 токена: утечка базы не даёт войти чужими сессиями
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions(user_id);

-- Неудачные входы и регистрации по ключу (email:..., ip:...) для ограничения частоты
CREATE TABLE auth_attempts (
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX auth_attempts_key ON auth_attempts(key, created_at);
