-- Вход через Яндекс ID: CHECK провайдера нельзя расширить без пересборки таблицы.
-- Привязки Google, VK ID, GitHub и Discord переносятся как есть

CREATE TABLE external_identities_new (
  account_sub TEXT NOT NULL REFERENCES accounts(sub) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'vk', 'github', 'discord', 'yandex')),
  -- Google — sub из ID token, GitHub — числовой id, VK — user_id, Discord — id, Яндекс — id. Почта и логин сюда не попадают: они меняются
  provider_user_id TEXT NOT NULL,
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
