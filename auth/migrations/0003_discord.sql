-- Вход через Discord: в external_identities провайдер ограничен CHECK, его нельзя изменить без пересборки таблицы.
-- Таблица пересоздаётся с тем же составом столбцов, привязки Google, VK ID и GitHub переносятся как есть

CREATE TABLE external_identities_new (
  account_sub TEXT NOT NULL REFERENCES accounts(sub) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'vk', 'github', 'discord')),
  -- Google — sub из ID token, GitHub — числовой id, VK — user_id, Discord — id (snowflake). Почта и логин сюда не попадают: они меняются
  provider_user_id TEXT NOT NULL,
  -- Для страницы аккаунта: с какой почтой и именем привязан провайдер. Для входа не используются
  email TEXT,
  display_name TEXT,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT,
  PRIMARY KEY (provider, provider_user_id),
  UNIQUE (account_sub, provider)
);

INSERT INTO external_identities_new (account_sub, provider, provider_user_id, email, display_name, linked_at, last_login_at)
  SELECT account_sub, provider, provider_user_id, email, display_name, linked_at, last_login_at FROM external_identities;

DROP TABLE external_identities;
ALTER TABLE external_identities_new RENAME TO external_identities;
