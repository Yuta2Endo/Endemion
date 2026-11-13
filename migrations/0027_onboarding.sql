-- Подсказки первого входа в панели аккаунта: пользователь может скрыть чек-лист,
-- и он больше не показывается (шаги при этом всё равно считаются по факту данных).
ALTER TABLE user_profiles ADD COLUMN onboarding_hidden INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_hidden IN (0, 1));
