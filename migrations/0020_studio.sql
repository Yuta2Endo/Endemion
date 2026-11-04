-- Портал Endemion Studio & Community: игры, публикации студии (новости, devlog, roadmap), категории форума, настройки сайта.
-- Миграция только добавляет таблицы и столбцы: прежние данные (обсуждения, комментарии, энциклопедия) не меняются.
-- Описания, статусы и платформы игр, кроме Endemion Life, не заполнены: их вносит администратор (решение владельца 2026-11-04)

-- ==================== ИГРЫ ====================
-- status NULL — «не указан». is_upcoming — показывать в разделе «Будущие проекты», а не в каталоге.
-- published 0 — черновик: страница игры видна только администраторам
CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 60 AND slug NOT GLOB '*[^a-z0-9-]*'),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  tagline TEXT NOT NULL DEFAULT '' CHECK (length(tagline) <= 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  status TEXT CHECK (status IS NULL OR status IN ('in_development', 'prototype', 'released', 'planned')),
  -- Платформы через запятую, например «Браузер, Android». Пусто — не указаны
  platforms TEXT NOT NULL DEFAULT '' CHECK (length(platforms) <= 200),
  -- Сайт игры: только https
  website_url TEXT NOT NULL DEFAULT '' CHECK (website_url = '' OR website_url LIKE 'https://%'),
  roadmap TEXT NOT NULL DEFAULT '' CHECK (length(roadmap) <= 5000),
  known_issues TEXT NOT NULL DEFAULT '' CHECK (length(known_issues) <= 5000),
  -- Обложка в хранилище картинок: games/<id>/cover/<версия>. NULL — заглушка с подписью
  cover_version INTEGER CHECK (cover_version IS NULL OR cover_version > 0),
  is_upcoming INTEGER NOT NULL DEFAULT 0 CHECK (is_upcoming IN (0, 1)),
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX games_list ON games(published, is_upcoming, position);

-- Скриншоты игры: games/<game_id>/media/<id> в хранилище картинок
CREATE TABLE game_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  caption TEXT NOT NULL DEFAULT '' CHECK (length(caption) <= 200),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX game_media_game ON game_media(game_id, position);

INSERT INTO games (slug, title, tagline, description, status, platforms, website_url, position) VALUES
  ('endemion-life', 'Endemion Life', 'Браузерный симулятор жизни с элементами RPG и интерактивной истории.',
   'Игрок рождается в одном из шести миров, проживает год за годом и принимает решения, которые меняют характеристики и судьбу персонажа.',
   'in_development', 'Браузер', 'https://life.endemion.online', 1),
  ('tetrus', 'TETRUS', '', '', NULL, '', '', 2),
  ('life-city', 'LIFE_CITY', '', '', NULL, '', '', 3),
  ('os-developer-simulator', 'OS Developer Simulator', '', '', NULL, '', '', 4),
  ('liforae', 'Liforae', '', '', NULL, '', '', 5);

-- ==================== ПУБЛИКАЦИИ СТУДИИ ====================
-- kind: news — новость студии, devlog — дневник разработки, update — обновление игры, roadmap — планы, announcement — анонс.
-- Черновики (draft) и архив (archived) видят только администраторы; published_at ставится при первой публикации
CREATE TABLE studio_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 80 AND slug NOT GLOB '*[^a-z0-9-]*'),
  kind TEXT NOT NULL CHECK (kind IN ('news', 'devlog', 'update', 'roadmap', 'announcement')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 400),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 50000),
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Картинка публикации: posts/<id>/<версия> в хранилище картинок
  image_version INTEGER CHECK (image_version IS NULL OR image_version > 0),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX studio_posts_feed ON studio_posts(status, published_at);
CREATE INDEX studio_posts_game ON studio_posts(game_id, status, published_at);

-- ==================== ФОРУМ ====================
-- Категории сгруппированы (section). game_id — категория обсуждения игры: на странице игры ведёт на неё
CREATE TABLE forum_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 60 AND slug NOT GLOB '*[^a-z0-9-]*'),
  section TEXT NOT NULL CHECK (section IN ('general', 'games', 'development', 'community')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  -- Писать новые темы могут только модераторы и администраторы (например, Devlog)
  staff_only INTEGER NOT NULL DEFAULT 0 CHECK (staff_only IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX forum_categories_section ON forum_categories(section, position);

INSERT INTO forum_categories (slug, section, title, description, position) VALUES
  ('general', 'general', 'Общее обсуждение', 'Всё, что касается Endemion и не подходит в другие разделы.', 1),
  ('introductions', 'general', 'Знакомство', 'Расскажите о себе и во что играете.', 2),
  ('suggestions', 'general', 'Предложения для сообщества', 'Идеи, как сделать сайт и сообщество лучше.', 3);

INSERT INTO forum_categories (slug, section, title, game_id, position)
  SELECT slug, 'games', title, id, position FROM games;
INSERT INTO forum_categories (slug, section, title, description, position) VALUES
  ('other-games', 'games', 'Другие игры', 'Игры не из каталога Endemion.', 99);

INSERT INTO forum_categories (slug, section, title, description, staff_only, position) VALUES
  ('devlog', 'development', 'Devlog', 'Обсуждение записей дневника разработки.', 1, 1),
  ('gamedev', 'development', 'Разработка игр', 'Вопросы и опыт разработки.', 0, 2),
  ('feature-requests', 'development', 'Пожелания', 'Чего не хватает в играх и на сайте.', 0, 3),
  ('bug-reports', 'development', 'Сообщения об ошибках', 'Что сломалось и как это повторить.', 0, 4);

INSERT INTO forum_categories (slug, section, title, description, position) VALUES
  ('off-topic', 'community', 'Оффтоп', 'Разговоры на любые темы.', 1),
  ('creative', 'community', 'Творчество', 'Арты, истории, музыка и моды.', 2),
  ('events', 'community', 'События', 'Конкурсы, турниры и встречи.', 3);

-- Темы форума — существующая таблица threads: добавляются категория, закрепление и закрытие.
-- Обсуждения, созданные до редизайна, попадают в «Общее обсуждение»
ALTER TABLE threads ADD COLUMN category_id INTEGER REFERENCES forum_categories(id) ON DELETE SET NULL;
ALTER TABLE threads ADD COLUMN pinned_at TEXT;
ALTER TABLE threads ADD COLUMN locked_at TEXT;
UPDATE threads SET category_id = (SELECT id FROM forum_categories WHERE slug = 'general');
CREATE INDEX threads_category ON threads(category_id, deleted_at, pinned_at, last_activity_at);

-- ==================== НАСТРОЙКИ САЙТА ====================
-- featured_game — slug главной игры на главной странице; social_links — JSON-массив [{"label": "...", "url": "https://..."}]
CREATE TABLE site_settings (
  key TEXT PRIMARY KEY CHECK (key IN ('featured_game', 'social_links', 'about_text')),
  value TEXT NOT NULL CHECK (length(value) <= 10000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO site_settings (key, value) VALUES ('featured_game', 'endemion-life'), ('social_links', '[]'), ('about_text', '');
