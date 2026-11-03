-- Endemion ID: аккаунты, связи с сайтами, токены писем, хранилище OIDC, ограничение попыток, журнал

-- Аккаунт Endemion ID. sub — постоянный идентификатор (UUID), его получают сайты в ID token.
-- Почта и username могут меняться, sub не меняется никогда
CREATE TABLE accounts (
  sub TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email_verified_at TEXT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  -- Номер версии загруженного аватара, NULL — буква на цветном фоне
  avatar_version INTEGER,
  -- scrypt$N$r$p$соль$хеш. У перенесённых с Endemion — pbkdf2$..., при первом входе меняется на scrypt
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  -- До какого времени (мс) вход закрыт после серии неверных паролей
  locked_until INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Связь аккаунта с пользователем конкретного сайта (users.id на Endemion, players.id в Life).
-- Нужна для перенесённых аккаунтов: сайт по ней находит своего старого пользователя
CREATE TABLE platform_links (
  account_sub TEXT NOT NULL REFERENCES accounts(sub) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('endemion', 'endemion_life')),
  platform_user_id TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (platform, platform_user_id),
  UNIQUE (account_sub, platform)
);

-- Ссылки из писем: подтверждение почты и новый пароль. В базе только SHA-256 токена
CREATE TABLE auth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_sub TEXT NOT NULL REFERENCES accounts(sub) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash TEXT NOT NULL UNIQUE,
  -- Почта, на которую ушло письмо: если её сменили, старая ссылка подтверждения не сработает
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX auth_tokens_account ON auth_tokens (account_sub, purpose);

-- Хранилище oidc-provider: сессии, коды, токены, гранты, interaction. Срок — в секундах Unix
CREATE TABLE oidc_models (
  model TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  grant_id TEXT,
  uid TEXT,
  user_code TEXT,
  account_id TEXT,
  expires_at INTEGER,
  consumed_at INTEGER,
  -- Только у сессий: с какого устройства и адреса вошли, для страницы «Сессии»
  user_agent TEXT,
  ip TEXT,
  PRIMARY KEY (model, id)
);
CREATE INDEX oidc_models_grant ON oidc_models (grant_id);
CREATE INDEX oidc_models_uid ON oidc_models (model, uid);
CREATE INDEX oidc_models_account ON oidc_models (model, account_id);
CREATE INDEX oidc_models_expires ON oidc_models (expires_at);

-- Попытки входа, регистрации и писем для ограничения частоты: ключ вида ip:..., email:..., reset:...
CREATE TABLE rate_events (
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX rate_events_key ON rate_events (key, created_at);

-- Журнал событий безопасности: входы, неудачи, смена пароля и почты, отзыв сессий
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_sub TEXT,
  event TEXT NOT NULL,
  ip TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX audit_log_account ON audit_log (account_sub, id);

-- Аккаунты, которые перенос не смог безопасно объединить (одна почта или username у разных людей).
-- Их разбирает владелец вручную, автоматически ничего не сливается
CREATE TABLE import_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_user_id TEXT NOT NULL,
  email TEXT,
  username TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source, source_user_id)
);
