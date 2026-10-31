-- Ссылки для восстановления пароля. Как и у сессий, в базе только SHA-256 токена: сам токен есть лишь в письме.
-- Ссылка одноразовая, живёт 1 час, у пользователя действует только последняя
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX password_resets_user ON password_resets(user_id);
