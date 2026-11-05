-- На каких сайтах экосистемы бывал аккаунт: первый и последний вход. Нужна админке endemion.online,
-- чтобы видеть игроков Life, которые на сам сайт не заходили. Пишется при каждой выдаче токенов сайту (grant.success).
-- Хранится client_id, а не platform: сайт по client_id определяется из OIDC_CLIENTS

CREATE TABLE client_activity (
  account_sub TEXT NOT NULL REFERENCES accounts(sub) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (account_sub, client_id)
);
CREATE INDEX client_activity_client ON client_activity (client_id, account_sub);

-- Входы до этой миграции: действующие гранты OIDC (живут 30 дней) и журнал входов (хранится год).
-- В журнале client_id лежит в detail: у login.success и register целиком, у social.* — после названия провайдера.
-- endemion-id — страницы самого Endemion ID, это не сайт
INSERT INTO client_activity (account_sub, client_id, first_seen_at, last_seen_at)
SELECT account_sub, client_id, MIN(seen_at), MAX(seen_at) FROM (
  SELECT account_id AS account_sub, json_extract(payload, '$.clientId') AS client_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', json_extract(payload, '$.iat'), 'unixepoch') AS seen_at
  FROM oidc_models WHERE model = 'Grant' AND json_extract(payload, '$.iat') IS NOT NULL
  UNION ALL
  SELECT account_sub, detail, created_at FROM audit_log WHERE event IN ('login.success', 'register')
  UNION ALL
  SELECT account_sub, substr(detail, instr(detail, ' ') + 1), created_at FROM audit_log
  WHERE event IN ('social.login', 'social.signup') AND instr(detail, ' ') > 0
)
WHERE account_sub IN (SELECT sub FROM accounts) AND client_id IS NOT NULL AND client_id <> '' AND client_id <> 'endemion-id'
GROUP BY account_sub, client_id;
