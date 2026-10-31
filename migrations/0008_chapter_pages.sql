-- Загруженные страницы глав лежат в R2 (бакет endemion-pages, ключ <тайтл>/<глава>/<страница>).
-- pages IS NULL — файлов нет, читалка показывает демо-страницы (SVG)
ALTER TABLE chapters ADD COLUMN pages INTEGER CHECK (pages IS NULL OR pages BETWEEN 1 AND 500);
-- Размер страниц главы в пикселях: для width/height у <img>, чтобы лента не прыгала, пока грузятся картинки
ALTER TABLE chapters ADD COLUMN page_width INTEGER CHECK (page_width IS NULL OR page_width > 0);
ALTER TABLE chapters ADD COLUMN page_height INTEGER CHECK (page_height IS NULL OR page_height > 0);
