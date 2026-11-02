-- Платформа ENDEMION: роли, профили, справочники (жанры, авторы, теги), отзывы, сообщество, уведомления,
-- Арена (голосования и турниры), достижения, жалобы на контент и журнал модерации.
-- Старые столбцы titles.genres (JSON) и titles.author (строка) остаются: это кеш для быстрых карточек и поиска,
-- источник правды теперь — таблицы title_genres и title_authors (их синхронизирует functions/_lib/taxonomy.js)

-- ==================== РОЛИ ====================
-- user — читатель, moderator — разбирает жалобы и скрывает контент, admin — всё, включая каталог и роли
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin'));
UPDATE users SET role = 'admin' WHERE is_admin = 1;
ALTER TABLE users DROP COLUMN is_admin;
-- До какого времени пользователь не может писать в сообществе (решение модератора). NULL — может
ALTER TABLE users ADD COLUMN muted_until TEXT;
CREATE INDEX users_role ON users(role);

-- ==================== ПРОФИЛИ ====================
CREATE TABLE user_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Адрес публичного профиля /u/<username>: латиница, цифры и «_»
  username TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 24),
  bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 500),
  -- Загруженный аватар: avatars/<user>/<версия> в хранилище картинок. NULL — буква на цветном фоне
  avatar_version INTEGER CHECK (avatar_version IS NULL OR avatar_version > 0),
  avatar_color TEXT NOT NULL DEFAULT 'violet' CHECK (avatar_color IN ('violet', 'blue', 'pink', 'teal', 'amber', 'crimson')),
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
  show_library INTEGER NOT NULL DEFAULT 1 CHECK (show_library IN (0, 1)),
  show_activity INTEGER NOT NULL DEFAULT 1 CHECK (show_activity IN (0, 1)),
  notify_chapters INTEGER NOT NULL DEFAULT 1 CHECK (notify_chapters IN (0, 1)),
  notify_replies INTEGER NOT NULL DEFAULT 1 CHECK (notify_replies IN (0, 1)),
  notify_follows INTEGER NOT NULL DEFAULT 1 CHECK (notify_follows IN (0, 1)),
  notify_achievements INTEGER NOT NULL DEFAULT 1 CHECK (notify_achievements IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO user_profiles (user_id, username) SELECT id, 'user' || id FROM users;

-- ==================== СПРАВОЧНИКИ ====================
CREATE TABLE genres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 30),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500)
);

CREATE TABLE title_genres (
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (title_id, genre_id)
);
CREATE INDEX title_genres_genre ON title_genres(genre_id);

CREATE TABLE authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 120),
  bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 1000)
);

CREATE TABLE title_authors (
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (title_id, author_id)
);
CREATE INDEX title_authors_author ON title_authors(author_id);

-- Любимые жанры, которые пользователь выбрал сам (ENDEMION ID). Учитываются в рекомендациях Oracle
CREATE TABLE user_genres (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, genre_id)
);

-- Перенос жанров и авторов существующих тайтлов из кеш-столбцов
INSERT OR IGNORE INTO genres (name) SELECT DISTINCT trim(g.value) FROM titles t, json_each(t.genres) g WHERE trim(g.value) <> '';
INSERT OR IGNORE INTO title_genres (title_id, genre_id, position)
  SELECT t.id, gn.id, g.key FROM titles t, json_each(t.genres) g JOIN genres gn ON gn.name = trim(g.value);
INSERT OR IGNORE INTO authors (name) SELECT DISTINCT trim(author) FROM titles WHERE trim(author) <> '';
INSERT OR IGNORE INTO title_authors (title_id, author_id) SELECT t.id, a.id FROM titles t JOIN authors a ON a.name = trim(t.author);

-- Теги для Nexus и Oracle: атмосфера, герой, сюжет, темы, место действия.
-- code — постоянный ключ: по нему Oracle выбирает настроения (functions/_lib/oracle.js)
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE CHECK (code GLOB '[a-z]*'),
  category TEXT NOT NULL CHECK (category IN ('mood', 'hero', 'plot', 'theme', 'setting')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  UNIQUE (category, name)
);

-- weight: насколько тег про этот тайтл (1 — есть, 2 — заметно, 3 — главное)
CREATE TABLE title_tags (
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  weight INTEGER NOT NULL DEFAULT 2 CHECK (weight BETWEEN 1 AND 3),
  PRIMARY KEY (title_id, tag_id)
);
CREATE INDEX title_tags_tag ON title_tags(tag_id);

INSERT INTO tags (code, category, name) VALUES
  ('mood-dark', 'mood', 'Мрачная'),
  ('mood-tense', 'mood', 'Напряжённая'),
  ('mood-warm', 'mood', 'Тёплая'),
  ('mood-funny', 'mood', 'Смешная'),
  ('mood-melancholic', 'mood', 'Меланхоличная'),
  ('mood-epic', 'mood', 'Эпичная'),
  ('mood-cozy', 'mood', 'Уютная'),
  ('mood-tragic', 'mood', 'Трагичная'),
  ('mood-mysterious', 'mood', 'Загадочная'),
  ('hero-overpowered', 'hero', 'Силён с самого начала'),
  ('hero-growth', 'hero', 'Путь от слабого к сильному'),
  ('hero-genius', 'hero', 'Гений и стратег'),
  ('hero-antihero', 'hero', 'Антигерой'),
  ('hero-female', 'hero', 'Сильная героиня'),
  ('hero-ensemble', 'hero', 'Команда героев'),
  ('hero-ordinary', 'hero', 'Обычный человек'),
  ('hero-reincarnated', 'hero', 'Перерождение'),
  ('hero-villain', 'hero', 'Злодей в главной роли'),
  ('plot-twist', 'plot', 'Неожиданные повороты'),
  ('plot-revenge', 'plot', 'Месть'),
  ('plot-leveling', 'plot', 'Система и уровни'),
  ('plot-tournament', 'plot', 'Турниры и поединки'),
  ('plot-mystery', 'plot', 'Расследование'),
  ('plot-journey', 'plot', 'Путешествие'),
  ('plot-survival', 'plot', 'Выживание'),
  ('plot-slowburn', 'plot', 'Медленное развитие отношений'),
  ('plot-time-loop', 'plot', 'Временная петля'),
  ('plot-politics', 'plot', 'Интриги и политика'),
  ('plot-school', 'plot', 'Школьная жизнь'),
  ('theme-friendship', 'theme', 'Дружба'),
  ('theme-love', 'theme', 'Любовь'),
  ('theme-family', 'theme', 'Семья'),
  ('theme-power', 'theme', 'Цена силы'),
  ('theme-identity', 'theme', 'Поиск себя'),
  ('theme-loss', 'theme', 'Утрата'),
  ('theme-war', 'theme', 'Война'),
  ('theme-food', 'theme', 'Кулинария'),
  ('theme-art', 'theme', 'Творчество'),
  ('theme-justice', 'theme', 'Справедливость'),
  ('theme-cultivation', 'theme', 'Культивация'),
  ('theme-redemption', 'theme', 'Искупление'),
  ('setting-modern-city', 'setting', 'Современный город'),
  ('setting-other-world', 'setting', 'Другой мир'),
  ('setting-dungeon', 'setting', 'Подземелья и врата'),
  ('setting-ancient-china', 'setting', 'Древний Китай'),
  ('setting-academy', 'setting', 'Академия'),
  ('setting-postapoc', 'setting', 'Постапокалипсис'),
  ('setting-palace', 'setting', 'Императорский двор'),
  ('setting-space', 'setting', 'Космос'),
  ('setting-village', 'setting', 'Глубинка'),
  ('setting-cyberpunk', 'setting', 'Киберпанк');

-- ==================== ТАЙТЛЫ: ДОПОЛНЕНИЯ ====================
ALTER TABLE titles ADD COLUMN original_title TEXT NOT NULL DEFAULT '';
-- Когда тайтл добавлен в каталог: сортировка «Новинки». Для старых тайтлов — дата изменения карточки
ALTER TABLE titles ADD COLUMN created_at TEXT NOT NULL DEFAULT '2026-01-01 00:00:00';
UPDATE titles SET created_at = updated_at;
-- День недели выхода глав у выходящих тайтлов (0 — воскресенье ... 6 — суббота): календарь Pulse
ALTER TABLE titles ADD COLUMN release_day INTEGER CHECK (release_day IS NULL OR release_day BETWEEN 0 AND 6);
-- Уникальные посетители страницы тайтла по дням (title_view_log): часть популярности
ALTER TABLE titles ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
-- Поиск только по названию, автору или жанру. Строки готовит Worker, как search_text (см. 0014_search.sql):
-- lower() в SQLite не работает с кириллицей
ALTER TABLE titles ADD COLUMN search_title TEXT NOT NULL DEFAULT '';
ALTER TABLE titles ADD COLUMN search_author TEXT NOT NULL DEFAULT '';
ALTER TABLE titles ADD COLUMN search_genres TEXT NOT NULL DEFAULT '';
CREATE INDEX titles_created ON titles(created_at);

-- Легальные источники: где читать официально. Только https-ссылки
CREATE TABLE title_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  url TEXT NOT NULL CHECK (url LIKE 'https://%' AND length(url) <= 500),
  kind TEXT NOT NULL DEFAULT 'official' CHECK (kind IN ('official', 'publisher', 'store', 'licensed')),
  language TEXT NOT NULL DEFAULT 'ru' CHECK (length(language) BETWEEN 2 AND 5),
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX title_sources_title ON title_sources(title_id, position);

-- Связи, которые задаёт администратор: продолжение, тот же мир, «похоже»
CREATE TABLE title_relations (
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  related_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('similar', 'sequel', 'prequel', 'spin_off', 'same_universe')),
  PRIMARY KEY (title_id, related_id),
  CHECK (title_id <> related_id)
);
CREATE INDEX title_relations_related ON title_relations(related_id);

CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  role TEXT NOT NULL DEFAULT 'main' CHECK (role IN ('main', 'supporting', 'antagonist')),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  symbol TEXT NOT NULL DEFAULT '✦',
  UNIQUE (title_id, name)
);

-- ==================== БИБЛИОТЕКА ====================
-- Новый статус on_hold («Отложено»). CHECK в SQLite не меняется, поэтому таблица пересоздаётся с переносом записей
CREATE TABLE library_new (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  status TEXT CHECK (status IN ('planned', 'reading', 'completed', 'on_hold', 'dropped')),
  chapter INTEGER NOT NULL DEFAULT 0 CHECK (chapter >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, title_id)
);
INSERT INTO library_new (user_id, title_id, favorite, status, chapter, updated_at, created_at)
  SELECT user_id, title_id, favorite, status, chapter, updated_at, updated_at FROM library;
DROP TABLE library;
ALTER TABLE library_new RENAME TO library;
CREATE INDEX library_title ON library(title_id);
CREATE INDEX library_user_updated ON library(user_id, updated_at);

-- История просмотра страниц тайтлов: одна строка на тайтл, время последнего просмотра
CREATE TABLE view_history (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, title_id)
);
CREATE INDEX view_history_user ON view_history(user_id, viewed_at);

-- Учёт уникальных посетителей за день: visitor — хеш IP и браузера, сам IP не хранится. Записи старше 2 дней удаляются
CREATE TABLE title_view_log (
  day TEXT NOT NULL,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  visitor TEXT NOT NULL,
  PRIMARY KEY (day, title_id, visitor)
);

-- ==================== ОТЗЫВЫ И ОЦЕНКИ ====================
-- Одна оценка (и необязательный текст) на пользователя и тайтл. Рейтинг читателей считается только по ним
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 5000),
  spoiler INTEGER NOT NULL DEFAULT 0 CHECK (spoiler IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Скрыт модератором: не виден и не входит в рейтинг
  hidden_at TEXT,
  hidden_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (user_id, title_id)
);
CREATE INDEX reviews_title ON reviews(title_id, hidden_at, created_at);

-- ==================== СООБЩЕСТВО ====================
-- Обсуждения и теории: у тайтла или общие (title_id IS NULL)
CREATE TABLE threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title_id INTEGER REFERENCES titles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('discussion', 'theory')),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 3 AND 140),
  body TEXT NOT NULL CHECK (length(body) <= 10000),
  spoiler INTEGER NOT NULL DEFAULT 0 CHECK (spoiler IN (0, 1)),
  comments_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX threads_activity ON threads(deleted_at, last_activity_at);
CREATE INDEX threads_title ON threads(title_id, last_activity_at);
CREATE INDEX threads_user ON threads(user_id);

-- Пользовательские подборки. featured — подборку выбрал администратор для главной
CREATE TABLE collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  hidden_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX collections_user ON collections(user_id);
CREATE INDEX collections_featured ON collections(featured, updated_at);

CREATE TABLE collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection_id, title_id)
);
CREATE INDEX collection_items_title ON collection_items(title_id);

-- Комментарии к тайтлу, обсуждению, подборке или отзыву. Ответы: parent_id — на что ответ, root_id — корневой комментарий.
-- Удалённый комментарий остаётся заглушкой (deleted_at), чтобы ответы на него не пропали
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('title', 'thread', 'collection', 'review')),
  target_id INTEGER NOT NULL,
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  root_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) <= 3000),
  spoiler INTEGER NOT NULL DEFAULT 0 CHECK (spoiler IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at TEXT,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
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

-- У комментариев цель задаётся парой (тип, id) без внешнего ключа: при удалении цели они удаляются триггерами
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

CREATE TABLE follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee ON follows(followee_id);

-- ==================== УВЕДОМЛЕНИЯ ====================
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('chapter', 'reply', 'follow', 'achievement', 'moderation', 'system')),
  title_id INTEGER REFERENCES titles(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  text TEXT NOT NULL CHECK (length(text) <= 300),
  -- Свой адрес на сайте, например /title/5 или /community/thread/3
  link TEXT NOT NULL DEFAULT '' CHECK (link = '' OR (link LIKE '/%' AND link NOT LIKE '//%')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);
CREATE INDEX notifications_user ON notifications(user_id, read_at, id);

-- ==================== АРЕНА ====================
CREATE TABLE polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('character', 'title', 'genre', 'versus')),
  question TEXT NOT NULL CHECK (length(question) BETWEEN 3 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Голосование закрывается само в это время (UTC). NULL — пока его не закроют вручную
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX polls_status ON polls(status, created_at);

CREATE TABLE poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  title_id INTEGER REFERENCES titles(id) ON DELETE SET NULL,
  character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  genre_id INTEGER REFERENCES genres(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX poll_options_poll ON poll_options(poll_id, position);
CREATE INDEX poll_options_character ON poll_options(character_id);

-- Один голос на голосование: его можно перенести на другой вариант, пока голосование открыто
CREATE TABLE votes (
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (poll_id, user_id)
);
CREATE INDEX votes_option ON votes(option_id);

CREATE TRIGGER votes_option_in_poll BEFORE INSERT ON votes
WHEN NOT EXISTS (SELECT 1 FROM poll_options WHERE id = NEW.option_id AND poll_id = NEW.poll_id)
BEGIN
  SELECT RAISE(ABORT, 'Вариант не из этого голосования');
END;
CREATE TRIGGER votes_option_in_poll_update BEFORE UPDATE OF option_id, poll_id ON votes
WHEN NOT EXISTS (SELECT 1 FROM poll_options WHERE id = NEW.option_id AND poll_id = NEW.poll_id)
BEGIN
  SELECT RAISE(ABORT, 'Вариант не из этого голосования');
END;

-- Турниры на выбывание: 4, 8 или 16 участников, раунд закрывает автор турнира или модератор
CREATE TABLE tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 100),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  kind TEXT NOT NULL CHECK (kind IN ('title', 'character')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'voting' CHECK (status IN ('voting', 'finished')),
  round INTEGER NOT NULL DEFAULT 1 CHECK (round >= 1),
  winner_entry_id INTEGER,
  hidden_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tournament_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  title_id INTEGER REFERENCES titles(id) ON DELETE SET NULL,
  character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  seed INTEGER NOT NULL CHECK (seed >= 1),
  UNIQUE (tournament_id, seed)
);

CREATE TABLE tournament_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round INTEGER NOT NULL CHECK (round >= 1),
  position INTEGER NOT NULL CHECK (position >= 1),
  entry_a INTEGER NOT NULL REFERENCES tournament_entries(id) ON DELETE CASCADE,
  entry_b INTEGER NOT NULL REFERENCES tournament_entries(id) ON DELETE CASCADE,
  winner_id INTEGER REFERENCES tournament_entries(id) ON DELETE SET NULL,
  UNIQUE (tournament_id, round, position)
);

CREATE TABLE tournament_votes (
  match_id INTEGER NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id INTEGER NOT NULL REFERENCES tournament_entries(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX tournament_votes_entry ON tournament_votes(entry_id);

-- ==================== ДОСТИЖЕНИЯ ====================
-- Условия получения — в functions/_lib/achievements.js по code
CREATE TABLE achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE user_achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, achievement_id)
);

INSERT INTO achievements (code, name, description, icon, position) VALUES
  ('first_shelf', 'Первая полка', 'Добавить первый тайтл в библиотеку', '📚', 1),
  ('collector_10', 'Коллекционер', '10 тайтлов в библиотеке', '🗂', 2),
  ('finisher_1', 'Финишная прямая', 'Дочитать первый тайтл', '🏁', 3),
  ('finisher_10', 'Марафонец', 'Дочитать 10 тайтлов', '🏃', 4),
  ('chapters_100', 'Сотня глав', 'Прочитать 100 глав', '💯', 5),
  ('chapters_1000', 'Тысяча глав', 'Прочитать 1000 глав', '🌌', 6),
  ('explorer_5', 'Исследователь жанров', 'Тайтлы пяти разных жанров в библиотеке', '🧭', 7),
  ('critic_1', 'Первая оценка', 'Оценить тайтл', '⭐', 8),
  ('critic_10', 'Критик', 'Оценить 10 тайтлов', '🎭', 9),
  ('voice_10', 'Голос сообщества', 'Написать 10 комментариев', '💬', 10),
  ('theorist', 'Теоретик', 'Опубликовать теорию', '🔮', 11),
  ('voter_10', 'Избиратель', 'Проголосовать в Арене 10 раз', '🗳', 12),
  ('curator', 'Куратор', 'Собрать подборку из 5 тайтлов', '🎨', 13),
  ('followed_5', 'Узнаваемый', '5 подписчиков', '🌟', 14);

-- ==================== ЖАЛОБЫ И МОДЕРАЦИЯ ====================
-- Жалобы пользователей на контент. Жалобы правообладателей — отдельно, в complaints (форма /copyright)
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('comment', 'review', 'thread', 'collection', 'user', 'tournament')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'spoiler', 'illegal', 'other')),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (reporter_id, target_type, target_id)
);
CREATE INDEX reports_status ON reports(status, created_at);
CREATE INDEX reports_target ON reports(target_type, target_id);

-- Что сделал модератор. Имя сохраняется на момент действия, как в audit_log
CREATE TABLE moderation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moderator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  moderator_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  report_id INTEGER REFERENCES reports(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX moderation_actions_created ON moderation_actions(created_at);

-- Счётчик действий для ограничения частоты (комментарии, голоса, жалобы). Окна до суток; старые записи чистит код
CREATE TABLE rate_events (
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX rate_events_key ON rate_events(key, created_at);
