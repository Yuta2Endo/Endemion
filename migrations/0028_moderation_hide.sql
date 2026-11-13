-- Автоскрытие после жалоб: скрытие обратимо, в отличие от удаления автором.
-- Скрытые строки остаются в базе, модератор видит их в админке и может вернуть.
ALTER TABLE comments ADD COLUMN hidden_at TEXT;
ALTER TABLE comments ADD COLUMN hidden_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE threads ADD COLUMN hidden_at TEXT;
ALTER TABLE threads ADD COLUMN hidden_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
