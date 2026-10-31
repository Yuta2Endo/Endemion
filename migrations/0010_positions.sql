-- Место в главе, на котором читатель остановился: одно на тайтл.
-- Нужно, чтобы на другом устройстве чтение продолжилось с той же страницы. Пишет читалка (/api/positions/:id)
CREATE TABLE positions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  chapter INTEGER NOT NULL CHECK (chapter > 0),
  page INTEGER NOT NULL CHECK (page > 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, title_id)
);
