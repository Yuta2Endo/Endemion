-- Обложки тайтлов: картинка в R2 под ключом covers/<тайтл>/<версия>. NULL — обложки нет, показывается градиент.
-- Версия растёт при каждой замене: адрес /covers/<тайтл>?v=<версия> меняется, и браузеры и соцсети не берут старую картинку из кеша
ALTER TABLE titles ADD COLUMN cover_version INTEGER CHECK (cover_version IS NULL OR cover_version > 0);
