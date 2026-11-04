-- Universe Explorer: карта вселенной произведения и хронология событий.
-- Основа карты — данные каталога (персонажи, создатели, студии, связанные произведения), в базе она не хранится.
-- Здесь только то, чего в каталоге нет: организации, локации и события, которые добавляет администратор,
-- и связи между ними и персонажами. У каждой записи обязателен источник (source_reference): эпизод, глава, справочник.
-- episode — с какого эпизода (или главы) это известно зрителю. NULL — запись не привязана к эпизоду.
-- spoiler_level: 0 — не спойлер, 1 — спойлер, 2 — финал. Записи без эпизода со spoiler_level > 0
-- в режиме «без спойлеров» скрыты, пока зритель не досмотрит произведение

CREATE TABLE universe_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('anime', 'manga')),
  ext_id INTEGER NOT NULL CHECK (ext_id > 0),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('organization', 'location', 'event')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  episode INTEGER CHECK (episode IS NULL OR episode > 0),
  -- Место события в хронологии мира. NULL — неизвестно. Есть только у событий
  chronology_order INTEGER,
  spoiler_level INTEGER NOT NULL DEFAULT 0 CHECK (spoiler_level BETWEEN 0 AND 2),
  source_reference TEXT NOT NULL CHECK (length(source_reference) BETWEEN 3 AND 300),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (chronology_order IS NULL OR entity_type = 'event'),
  UNIQUE (kind, ext_id, entity_type, title)
);
CREATE INDEX universe_entities_entry ON universe_entities(kind, ext_id, entity_type);

-- Конец связи: персонаж каталога (character — номер персонажа в каталоге) или сущность отсюда (entity — universe_entities.id)
CREATE TABLE universe_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('anime', 'manga')),
  ext_id INTEGER NOT NULL CHECK (ext_id > 0),
  source_type TEXT NOT NULL CHECK (source_type IN ('character', 'entity')),
  source_id INTEGER NOT NULL CHECK (source_id > 0),
  target_type TEXT NOT NULL CHECK (target_type IN ('character', 'entity')),
  target_id INTEGER NOT NULL CHECK (target_id > 0),
  relation_type TEXT NOT NULL CHECK (relation_type IN (
    'friend', 'family', 'enemy', 'rival', 'mentor', 'member_of', 'participates_in', 'located_in'
  )),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  episode INTEGER CHECK (episode IS NULL OR episode > 0),
  spoiler_level INTEGER NOT NULL DEFAULT 0 CHECK (spoiler_level BETWEEN 0 AND 2),
  source_reference TEXT NOT NULL CHECK (length(source_reference) BETWEEN 3 AND 300),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Связь объекта с самим собой не имеет смысла
  CHECK (NOT (source_type = target_type AND source_id = target_id)),
  UNIQUE (kind, ext_id, source_type, source_id, target_type, target_id, relation_type)
);
CREATE INDEX universe_relations_entry ON universe_relations(kind, ext_id);
CREATE INDEX universe_relations_source ON universe_relations(source_type, source_id);
CREATE INDEX universe_relations_target ON universe_relations(target_type, target_id);

-- Сущность удалена — её связи тоже: у связи нет внешнего ключа, потому что конец может быть и персонажем каталога
CREATE TRIGGER universe_entities_delete_relations AFTER DELETE ON universe_entities BEGIN
  DELETE FROM universe_relations
  WHERE (source_type = 'entity' AND source_id = OLD.id) OR (target_type = 'entity' AND target_id = OLD.id);
END;

-- Режим спойлеров, который зритель выбрал для произведения: safe — без спойлеров, full — полная энциклопедия.
-- Нет строки — без спойлеров
CREATE TABLE user_spoiler_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('anime', 'manga')),
  ext_id INTEGER NOT NULL CHECK (ext_id > 0),
  mode TEXT NOT NULL CHECK (mode IN ('safe', 'full')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, kind, ext_id)
);
