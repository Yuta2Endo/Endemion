-- Вход через внешних провайдеров: Google, VK ID, GitHub.
-- Аккаунт связывается с внешней личностью только по её постоянному номеру у провайдера, не по почте

-- Привязанные внешние личности. Одна личность провайдера — один Endemion ID, у аккаунта не больше одной личности на провайдера
CREATE TABLE external_identities (
  account_sub TEXT NOT NULL REFERENCES accounts(sub) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'vk', 'github')),
  -- Google — sub из ID token, GitHub — числовой id, VK — user_id. Почта и логин сюда не попадают: они меняются
  provider_user_id TEXT NOT NULL,
  -- Для страницы аккаунта: с какой почтой и именем привязан провайдер. Для входа не используются
  email TEXT,
  display_name TEXT,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT,
  PRIMARY KEY (provider, provider_user_id),
  UNIQUE (account_sub, provider)
);

-- Начатые входы через провайдера. В браузер уходит только state (в cookie), здесь его SHA-256.
-- Запись удаляется при первом ответе провайдера: тот же ответ второй раз не примется
CREATE TABLE social_logins (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'link')),
  -- Вход сайта, который ждёт результата (purpose = login)
  interaction_uid TEXT,
  -- Аккаунт, к которому привязывается провайдер (purpose = link)
  account_sub TEXT REFERENCES accounts(sub) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  nonce TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX social_logins_expires ON social_logins (expires_at);

-- Личность провайдера без аккаунта: ждёт, пока пользователь завершит регистрацию (почта, username, согласие).
-- В браузере только токен в скрытом поле формы, здесь его SHA-256
CREATE TABLE social_pending (
  token_hash TEXT PRIMARY KEY,
  interaction_uid TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  name TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX social_pending_expires ON social_pending (expires_at);
