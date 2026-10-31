-- Поиск по каталогу на сервере (/api/titles?q=...). search_text — название, автор, перевод, тип и жанры
-- в нижнем регистре, «ё» заменена на «е». lower() и LIKE в SQLite меняют регистр только у латиницы,
-- поэтому строку готовит Worker (searchText в functions/_lib/titles.js) при каждом сохранении тайтла в админке.
-- FTS5 не используется: wrangler d1 export не выгружает базы с виртуальными таблицами, а на выгрузке держатся резервные копии.
-- На момент миграции каталог пуст, заполнять строку для старых тайтлов не нужно
ALTER TABLE titles ADD COLUMN search_text TEXT NOT NULL DEFAULT '';

-- Выдача по умолчанию отсортирована по рейтингу, страницы берутся через LIMIT
CREATE INDEX titles_rating ON titles(rating DESC, id);
