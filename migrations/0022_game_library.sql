-- Избранные игры пользователей. Ссылка на пользователя и игру, каждая пара уникальна.
-- Показывается в приватном профиле владельца и на страницах игр (кнопка «В избранное»).
CREATE TABLE game_library (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, game_id)
);
CREATE INDEX game_library_user ON game_library(user_id, created_at);
CREATE INDEX game_library_game ON game_library(game_id);
