-- Ошибки браузера: падение скрипта на странице должно быть видно без консоли.
-- Пишем только сообщение, файл, строку и адрес страницы — без содержимого форм и куки.
CREATE TABLE client_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL CHECK (length(message) <= 500),
  source TEXT CHECK (source IS NULL OR length(source) <= 300),
  line INTEGER,
  url TEXT CHECK (url IS NULL OR length(url) <= 300),
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX client_errors_created ON client_errors(created_at);
