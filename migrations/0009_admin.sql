-- Администраторы и версии загруженных страниц.
-- Права выдаются только командой wrangler (см. README), через сайт стать администратором нельзя
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1));

-- Номер загрузки страниц главы. Страницы лежат в R2 под ключом <тайтл>/<глава>/<версия>/<страница>:
-- новая загрузка пишется в следующую версию и видна читателям только после публикации
ALTER TABLE chapters ADD COLUMN pages_version INTEGER NOT NULL DEFAULT 0;
