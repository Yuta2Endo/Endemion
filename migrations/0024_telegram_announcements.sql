-- Анонсы обновлений игр в Telegram-канал @EndemionOfficial.
-- Источник релиза — опубликованная запись студии (kind "update") из studio_posts.
-- Публикация только явно, действием администратора; никогда автоматически.

-- Версия выпуска записи студии (необязательно, пример: 1.2.0)
ALTER TABLE studio_posts ADD COLUMN version TEXT;

-- История попыток публикации в Телеграм: защита от дублей и статус доставки.
-- Один пост — одна запись. status = 'published' означает, что анонс уже ушёл в канал.
CREATE TABLE telegram_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL UNIQUE REFERENCES studio_posts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'failed')) DEFAULT 'pending',
  chat_id TEXT NOT NULL,
  message_id INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);
CREATE INDEX telegram_posts_post ON telegram_posts(post_id);
CREATE INDEX telegram_posts_status ON telegram_posts(status);
