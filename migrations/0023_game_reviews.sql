-- Оценки и отзывы пользователей к играм.
-- Одна оценка (и опциональный текст) на пользователя и игру.
-- hidden_at — отзыв скрыт модератором: не виден публично и не входит в средний рейтинг.
CREATE TABLE game_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 5000),
  spoiler INTEGER NOT NULL DEFAULT 0 CHECK (spoiler IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  hidden_at TEXT,
  UNIQUE (user_id, game_id)
);
CREATE INDEX game_reviews_game ON game_reviews(game_id, hidden_at, created_at);
CREATE INDEX game_reviews_user ON game_reviews(user_id);
