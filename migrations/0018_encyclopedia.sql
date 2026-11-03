-- Энциклопедия аниме и манги. Каталог (произведения, персонажи, люди, студии) берётся из внешнего источника
-- через единый слой functions/_lib/catalog и кешируется. В базе Endemion хранятся только данные пользователей
-- (списки, оценки, избранное, отзывы, комментарии) и короткие снимки произведений, с которыми они связаны

-- ==================== СНИМКИ ПРОИЗВЕДЕНИЙ ====================
-- Строка появляется, когда пользователь добавляет произведение в список, избранное или пишет отзыв.
-- По снимку список пользователя показывается без запросов к источнику. (kind, ext_id) — номер в источнике, без повторов
CREATE TABLE entries (
  kind TEXT NOT NULL CHECK (kind IN ('anime', 'manga')),
  ext_id INTEGER NOT NULL CHECK (ext_id > 0),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  -- JSON: { small, small2x, medium, large } — адреса постеров в источнике
  poster TEXT NOT NULL DEFAULT '{}',
  type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  year INTEGER,
  -- Серий или глав всего и уже вышло. 0 — неизвестно
  units INTEGER NOT NULL DEFAULT 0,
  units_aired INTEGER NOT NULL DEFAULT 0,
  -- Длительность серии в минутах: для статистики «сколько часов просмотрено»
  duration INTEGER NOT NULL DEFAULT 0,
  score REAL,
  -- JSON: [{ id, name }]
  genres TEXT NOT NULL DEFAULT '[]',
  refreshed_at INTEGER NOT NULL,
  PRIMARY KEY (kind, ext_id)
);

-- ==================== СПИСКИ ====================
-- status: planned — планирую, current — смотрю или читаю, completed, on_hold — отложено, dropped — брошено
CREATE TABLE user_list (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ext_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'current', 'completed', 'on_hold', 'dropped')),
  score INTEGER CHECK (score IS NULL OR score BETWEEN 1 AND 10),
  -- Просмотрено серий или прочитано глав
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100000),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, kind, ext_id),
  FOREIGN KEY (kind, ext_id) REFERENCES entries(kind, ext_id)
);
CREATE INDEX user_list_entry ON user_list(kind, ext_id, score);
CREATE INDEX user_list_user ON user_list(user_id, kind, status, updated_at);

-- Избранное: произведения, персонажи и люди. Имя и картинка — снимок на момент добавления
CREATE TABLE favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('anime', 'manga', 'character', 'person')),
  ext_id INTEGER NOT NULL CHECK (ext_id > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  image TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, target_type, ext_id)
);
CREATE INDEX favorites_target ON favorites(target_type, ext_id);

-- ==================== ОТЗЫВЫ ====================
-- Один отзыв на пользователя и произведение. Автор правит и удаляет свой, модератор скрывает
CREATE TABLE entry_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ext_id INTEGER NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  spoiler INTEGER NOT NULL DEFAULT 0 CHECK (spoiler IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  hidden_at TEXT,
  hidden_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (user_id, kind, ext_id),
  FOREIGN KEY (kind, ext_id) REFERENCES entries(kind, ext_id)
);
CREATE INDEX entry_reviews_entry ON entry_reviews(kind, ext_id, hidden_at, updated_at);
CREATE INDEX entry_reviews_recent ON entry_reviews(hidden_at, created_at);

-- ==================== ИСТОЧНИК ДАННЫХ ====================
-- Кеш ответов источника. Просроченная запись остаётся на случай, если источник недоступен (показывается устаревшая копия)
CREATE TABLE catalog_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX catalog_cache_expires ON catalog_cache(expires_at);

-- Ошибки обращений к источнику: для раздела «Каталог» в админке
CREATE TABLE catalog_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  status INTEGER,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX catalog_errors_created ON catalog_errors(created_at);

-- Настройки каталога из админки: взрослый контент, скрытые жанры, произведение для главной
CREATE TABLE catalog_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ==================== КОММЕНТАРИИ И ЖАЛОБЫ: НОВЫЕ ЦЕЛИ ====================
-- CHECK в SQLite не меняется, поэтому comments и reports пересоздаются с переносом всех строк и тех же id.
-- Триггеры других таблиц ссылаются на comments: они удаляются и создаются заново, иначе переименование таблицы не пройдёт

DROP TRIGGER titles_delete_comments;
DROP TRIGGER threads_delete_comments;
DROP TRIGGER collections_delete_comments;
DROP TRIGGER reviews_delete_comments;

-- Реакции ссылаются на comments с каскадным удалением: на время пересоздания они переносятся в копию
CREATE TABLE comment_reactions_copy AS SELECT comment_id, user_id, kind, created_at FROM comment_reactions;
DROP TABLE comment_reactions;

-- Ответы ссылаются на саму таблицу. Ссылка на comments_new после переименования станет ссылкой на comments
CREATE TABLE comments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('title', 'thread', 'collection', 'review', 'anime', 'manga', 'character', 'person', 'entry_review')),
  target_id INTEGER NOT NULL,
  parent_id INTEGER REFERENCES comments_new(id) ON DELETE CASCADE,
  root_id INTEGER REFERENCES comments_new(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) <= 3000),
  spoiler INTEGER NOT NULL DEFAULT 0 CHECK (spoiler IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at TEXT,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO comments_new (id, user_id, target_type, target_id, parent_id, root_id, body, spoiler, created_at, edited_at, deleted_at, deleted_by)
  SELECT id, user_id, target_type, target_id, parent_id, root_id, body, spoiler, created_at, edited_at, deleted_at, deleted_by FROM comments ORDER BY id;
DROP TABLE comments;
ALTER TABLE comments_new RENAME TO comments;
CREATE INDEX comments_target ON comments(target_type, target_id, root_id, created_at);
CREATE INDEX comments_root ON comments(root_id);
CREATE INDEX comments_user ON comments(user_id, created_at);

CREATE TABLE comment_reactions (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('like', 'fire', 'heart', 'laugh', 'wow', 'sad')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (comment_id, user_id, kind)
);
INSERT INTO comment_reactions (comment_id, user_id, kind, created_at) SELECT comment_id, user_id, kind, created_at FROM comment_reactions_copy;
DROP TABLE comment_reactions_copy;

CREATE TRIGGER titles_delete_comments AFTER DELETE ON titles BEGIN
  DELETE FROM comments WHERE target_type = 'title' AND target_id = OLD.id;
END;
CREATE TRIGGER threads_delete_comments AFTER DELETE ON threads BEGIN
  DELETE FROM comments WHERE target_type = 'thread' AND target_id = OLD.id;
END;
CREATE TRIGGER collections_delete_comments AFTER DELETE ON collections BEGIN
  DELETE FROM comments WHERE target_type = 'collection' AND target_id = OLD.id;
END;
CREATE TRIGGER reviews_delete_comments AFTER DELETE ON reviews BEGIN
  DELETE FROM comments WHERE target_type = 'review' AND target_id = OLD.id;
END;
CREATE TRIGGER entry_reviews_delete_comments AFTER DELETE ON entry_reviews BEGIN
  DELETE FROM comments WHERE target_type = 'entry_review' AND target_id = OLD.id;
END;

-- Журнал модерации ссылается на reports с ON DELETE SET NULL: ссылки сохраняются и возвращаются после пересоздания
CREATE TABLE moderation_report_links AS SELECT id, report_id FROM moderation_actions WHERE report_id IS NOT NULL;

CREATE TABLE reports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('comment', 'review', 'thread', 'collection', 'user', 'tournament', 'entry_review')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'spoiler', 'illegal', 'other')),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (reporter_id, target_type, target_id)
);
INSERT INTO reports_new (id, reporter_id, target_type, target_id, reason, details, status, resolved_by, resolved_at, created_at)
  SELECT id, reporter_id, target_type, target_id, reason, details, status, resolved_by, resolved_at, created_at FROM reports ORDER BY id;
DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;
CREATE INDEX reports_status ON reports(status, created_at);
CREATE INDEX reports_target ON reports(target_type, target_id);

UPDATE moderation_actions SET report_id = (SELECT l.report_id FROM moderation_report_links l WHERE l.id = moderation_actions.id)
  WHERE id IN (SELECT id FROM moderation_report_links);
DROP TABLE moderation_report_links;
