-- Главы тайтлов: название, том, пометка побочной истории и дата выхода.
-- Число глав и дата последней главы теперь считаются по этой таблице (functions/_lib/titles.js),
-- а titles.updated_at — дата изменения карточки, она нужна только тайтлам без глав

CREATE TABLE chapters (
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  -- Номер главы: 1, 2, 3... подряд без пропусков (проверяют триггеры ниже)
  number INTEGER NOT NULL CHECK (number > 0),
  -- Название главы, если оно есть
  name TEXT,
  volume INTEGER CHECK (volume > 0),
  -- 1 — побочная история (экстра)
  side_story INTEGER NOT NULL DEFAULT 0 CHECK (side_story IN (0, 1)),
  released_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (title_id, number)
);

CREATE INDEX chapters_released ON chapters(released_at);

-- Читалка, прогресс и список глав считают, что главы идут подряд с 1: пропуск сломал бы ссылку на следующую главу
CREATE TRIGGER chapters_insert_in_order BEFORE INSERT ON chapters
WHEN NEW.number <> COALESCE((SELECT MAX(number) FROM chapters WHERE title_id = NEW.title_id), 0) + 1
BEGIN
  SELECT RAISE(ABORT, 'Новая глава должна идти следующей по номеру');
END;

-- Удалить можно только последнюю главу. При удалении тайтла его главы удаляются все (тайтла уже нет)
CREATE TRIGGER chapters_delete_last BEFORE DELETE ON chapters
WHEN EXISTS (SELECT 1 FROM titles WHERE id = OLD.title_id)
  AND OLD.number < (SELECT MAX(number) FROM chapters WHERE title_id = OLD.title_id)
BEGIN
  SELECT RAISE(ABORT, 'Удалять можно только последнюю главу');
END;

CREATE TRIGGER chapters_number_fixed BEFORE UPDATE OF number, title_id ON chapters
WHEN NEW.number <> OLD.number OR NEW.title_id <> OLD.title_id
BEGIN
  SELECT RAISE(ABORT, 'Номер главы и тайтл у главы менять нельзя');
END;

-- Каталог пуст, переносить нечего: число глав теперь берётся из таблицы chapters
ALTER TABLE titles DROP COLUMN chapters;
