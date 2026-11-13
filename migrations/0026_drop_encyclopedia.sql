-- Раздел энциклопедии (аниме и манга: тайтлы, главы, персонажи, коллекции, опросы, турниры,
-- Universe Explorer, внешний каталог) выведен с сайта: страницы отдают 301, API нет.
-- Миграция убирает оставшиеся от него таблицы, чтобы схема базы соответствовала сайту.
-- Общие таблицы форума, игр, студии и аккаунтов не трогаем: у них своя жизнь.

-- Сначала триггеры энциклопедии: они ссылаются на удаляемые таблицы и мешают перестройке схемы
DROP TRIGGER IF EXISTS chapters_insert_in_order;
DROP TRIGGER IF EXISTS chapters_delete_last;
DROP TRIGGER IF EXISTS chapters_number_fixed;
DROP TRIGGER IF EXISTS votes_option_in_poll;
DROP TRIGGER IF EXISTS votes_option_in_poll_update;
DROP TRIGGER IF EXISTS titles_delete_comments;
DROP TRIGGER IF EXISTS collections_delete_comments;
DROP TRIGGER IF EXISTS reviews_delete_comments;
DROP TRIGGER IF EXISTS entry_reviews_delete_comments;
DROP TRIGGER IF EXISTS universe_entities_delete_relations;

-- Форум: связь с тайтлами больше не нужна. Обнуляем до удаления таблицы: иначе DROP TABLE titles
-- каскадом снёс бы темы, привязанные к тайтлам (сейчас таких нет, но миграция должна быть безопасной).
UPDATE threads SET title_id = NULL;
DROP INDEX IF EXISTS threads_title;
ALTER TABLE threads DROP COLUMN title_id;

-- Дочерние таблицы энциклопедии
DROP TABLE IF EXISTS collection_items;
DROP TABLE IF EXISTS collections;
DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS poll_options;
DROP TABLE IF EXISTS polls;
DROP TABLE IF EXISTS tournament_matches;
DROP TABLE IF EXISTS tournament_votes;
DROP TABLE IF EXISTS tournament_entries;
DROP TABLE IF EXISTS tournaments;
DROP TABLE IF EXISTS title_relations;
DROP TABLE IF EXISTS title_sources;
DROP TABLE IF EXISTS title_tags;
DROP TABLE IF EXISTS title_genres;
DROP TABLE IF EXISTS title_authors;
DROP TABLE IF EXISTS chapters;
DROP TABLE IF EXISTS title_view_log;
DROP TABLE IF EXISTS view_history;
DROP TABLE IF EXISTS library;
DROP TABLE IF EXISTS favorites;
DROP TABLE IF EXISTS entry_reviews;
DROP TABLE IF EXISTS entries;
DROP TABLE IF EXISTS characters;
DROP TABLE IF EXISTS user_list;
DROP TABLE IF EXISTS user_genres;
DROP TABLE IF EXISTS user_spoiler_settings;
DROP TABLE IF EXISTS positions;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS universe_relations;
DROP TABLE IF EXISTS universe_entities;

-- Уведомления: убираем ссылку на тайтлы (уведомления о главах больше не бывает).
-- Пересобираем таблицу, чтобы не осталось висячего внешнего ключа на удаляемый titles.
CREATE TABLE notifications_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('chapter', 'reply', 'follow', 'achievement', 'moderation', 'system', 'mention')),
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  text TEXT NOT NULL CHECK (length(text) <= 300),
  link TEXT NOT NULL DEFAULT '' CHECK (link = '' OR (link LIKE '/%' AND link NOT LIKE '//%')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);
INSERT INTO notifications_next (id, user_id, kind, actor_id, text, link, created_at, read_at)
  SELECT id, user_id, kind, actor_id, text, link, created_at, read_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_next RENAME TO notifications;
CREATE INDEX notifications_user ON notifications(user_id, read_at, id);

-- Справочники и сам каталог
DROP TABLE IF EXISTS titles;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS genres;
DROP TABLE IF EXISTS authors;
DROP TABLE IF EXISTS catalog_cache;
DROP TABLE IF EXISTS catalog_errors;
DROP TABLE IF EXISTS catalog_settings;
