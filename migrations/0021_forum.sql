-- Форум: подписка на тему, упоминания и история правок.
-- Миграция только добавляет: уведомления 'mention' пересоздают таблицу с копированием строк, данные не теряются

-- Подписка на тему: новые ответы приходят уведомлением. Автор подписывается сам при создании темы
CREATE TABLE thread_subscriptions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, thread_id)
);
CREATE INDEX thread_subscriptions_thread ON thread_subscriptions(thread_id);

-- Прежний текст правки: тема или ответ. Хранится до 20 последних версий на запись
CREATE TABLE content_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK (target_type IN ('thread', 'comment')),
  target_id INTEGER NOT NULL,
  subject TEXT CHECK (subject IS NULL OR length(subject) <= 140),
  body TEXT NOT NULL CHECK (length(body) <= 10000),
  edited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX content_revisions_target ON content_revisions(target_type, target_id, id);

-- Уведомление 'mention' — кто-то написал @имя профиля. CHECK нельзя расширить без пересоздания таблицы
CREATE TABLE notifications_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('chapter', 'reply', 'follow', 'achievement', 'moderation', 'system', 'mention')),
  title_id INTEGER REFERENCES titles(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  text TEXT NOT NULL CHECK (length(text) <= 300),
  link TEXT NOT NULL DEFAULT '' CHECK (link = '' OR (link LIKE '/%' AND link NOT LIKE '//%')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);
INSERT INTO notifications_new (id, user_id, kind, title_id, actor_id, text, link, created_at, read_at)
  SELECT id, user_id, kind, title_id, actor_id, text, link, created_at, read_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX notifications_user ON notifications(user_id, read_at, id);
