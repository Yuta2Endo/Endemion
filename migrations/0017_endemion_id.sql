-- Вход через Endemion ID (auth.endemion.online, OpenID Connect).
-- Миграция только добавляет столбцы и таблицу: старые аккаунты, пароли и сессии остаются как были,
-- поэтому при ENDEMION_ID=0 сайт работает по-старому (откат без восстановления базы)

-- Постоянный идентификатор пользователя в Endemion ID (claim sub). NULL — аккаунт ещё не связан
ALTER TABLE users ADD COLUMN endemion_sub TEXT;
CREATE UNIQUE INDEX users_endemion_sub ON users (endemion_sub) WHERE endemion_sub IS NOT NULL;

-- Адрес аватара в Endemion ID. Если задан, /avatars/:id отдаёт эту картинку вместо загруженной на сайт
ALTER TABLE user_profiles ADD COLUMN avatar_url TEXT;

-- Сессия, созданная входом через Endemion ID: зашифрованный refresh token, когда его обновляли (мс)
-- и когда пользователь последний раз вводил пароль (auth_time, секунды)
ALTER TABLE sessions ADD COLUMN refresh_token TEXT;
ALTER TABLE sessions ADD COLUMN refreshed_at INTEGER;
-- Последняя успешная сверка с Endemion ID (мс): от неё считается запас на время недоступности провайдера
ALTER TABLE sessions ADD COLUMN last_ok_at INTEGER;
ALTER TABLE sessions ADD COLUMN auth_time INTEGER;

-- Начатые входы: PKCE verifier, nonce и страница возврата. Ключ — SHA-256 от state из cookie браузера
CREATE TABLE oidc_logins (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  next_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
