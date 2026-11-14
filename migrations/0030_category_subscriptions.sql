-- Подписка на категорию форума: участник узнаёт о новых темах в разделе.
-- На ответы внутри тем по-прежнему работает thread_subscriptions.
CREATE TABLE category_subscriptions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, category_id)
);

CREATE INDEX category_subscriptions_category ON category_subscriptions(category_id);
