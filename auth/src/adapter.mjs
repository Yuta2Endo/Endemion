// Хранилище oidc-provider в SQLite: сессии, interaction, коды, токены и гранты в таблице oidc_models.
// Интерфейс описан в node_modules/oidc-provider/lib/adapters/memory_adapter.js

import Provider from "oidc-provider";

const now = () => Math.floor(Date.now() / 1000);

export function createAdapter(db) {
  const upsert = db.prepare(
    `INSERT INTO oidc_models (model, id, payload, grant_id, uid, user_code, account_id, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (model, id) DO UPDATE SET payload = excluded.payload, grant_id = excluded.grant_id, uid = excluded.uid,
       user_code = excluded.user_code, account_id = excluded.account_id, expires_at = excluded.expires_at,
       user_agent = COALESCE(oidc_models.user_agent, excluded.user_agent), ip = COALESCE(oidc_models.ip, excluded.ip)`
  );
  const byId = db.prepare("SELECT payload, expires_at, consumed_at FROM oidc_models WHERE model = ? AND id = ?");
  const byUid = db.prepare("SELECT payload, expires_at, consumed_at FROM oidc_models WHERE model = ? AND uid = ?");
  const byUserCode = db.prepare("SELECT payload, expires_at, consumed_at FROM oidc_models WHERE model = ? AND user_code = ?");
  const consume = db.prepare("UPDATE oidc_models SET consumed_at = ? WHERE model = ? AND id = ?");
  const destroy = db.prepare("DELETE FROM oidc_models WHERE model = ? AND id = ?");
  const revokeGrant = db.prepare("DELETE FROM oidc_models WHERE grant_id = ?");

  function read(row) {
    if (!row) return undefined;
    if (row.expires_at !== null && row.expires_at <= now()) return undefined;
    const payload = JSON.parse(row.payload);
    if (row.consumed_at) payload.consumed = row.consumed_at;
    return payload;
  }

  return class SqliteAdapter {
    constructor(model) {
      this.model = model;
    }

    async upsert(id, payload, expiresIn) {
      let userAgent = null;
      let ip = null;
      if (this.model === "Session") {
        // Устройство и адрес запоминаются при создании сессии, чтобы показать их на странице «Сессии»
        const ctx = Provider.ctx;
        userAgent = ctx?.get("user-agent")?.slice(0, 256) || null;
        ip = ctx?.ip || null;
      }
      upsert.run(
        this.model,
        id,
        JSON.stringify(payload),
        payload.grantId ?? null,
        payload.uid ?? null,
        payload.userCode ?? null,
        payload.accountId ?? null,
        expiresIn ? now() + expiresIn : null,
        userAgent,
        ip
      );
    }

    async find(id) {
      return read(byId.get(this.model, id));
    }

    async findByUid(uid) {
      return read(byUid.get(this.model, uid));
    }

    async findByUserCode(userCode) {
      return read(byUserCode.get(this.model, userCode));
    }

    async consume(id) {
      consume.run(now(), this.model, id);
    }

    async destroy(id) {
      destroy.run(this.model, id);
    }

    async revokeByGrantId(grantId) {
      revokeGrant.run(grantId);
    }
  };
}

/** Удалить истёкшие записи. Вызывается по таймеру, чтобы таблица не росла */
export function cleanupExpired(db) {
  db.prepare("DELETE FROM oidc_models WHERE expires_at IS NOT NULL AND expires_at <= ?").run(now());
}
