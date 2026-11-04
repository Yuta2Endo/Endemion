// Аккаунты Endemion ID: проверка данных, регистрация, вход с блокировкой после неудач, профиль, пароль

import { randomUUID } from "node:crypto";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./passwords.mjs";
import { LOCK_AFTER, LOCK_MS } from "./limits.mjs";
import { transaction } from "./db.mjs";

// Хеш аккаунта, созданного через Google, VK ID или GitHub: не подходит ни к одному паролю (verifyPassword вернёт false)
export const NO_PASSWORD = "!";

// Те же правила, что у сайта Endemion (functions/_lib/validate.js и profiles.js), чтобы перенесённые данные проходили проверку
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
const RESERVED_USERNAMES = new Set(["admin", "administrator", "root", "support", "endemion", "moderator", "system", "api", "auth", "login", "logout", "account", "sessions"]);

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

/** Имя без управляющих символов и лишних пробелов */
export function normalizeName(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
}

export function validateEmail(email) {
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return "Укажите правильный адрес почты.";
  return null;
}

export function validateUsername(username) {
  if (!USERNAME_RE.test(username)) return "Имя пользователя: от 3 до 24 латинских букв, цифр или знаков _.";
  if (RESERVED_USERNAMES.has(username.toLowerCase())) return "Это имя пользователя занято.";
  return null;
}

export function validateDisplayName(name) {
  if (name.length < 2 || name.length > 40) return "Отображаемое имя: от 2 до 40 символов.";
  return null;
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) return `Пароль должен быть не короче ${PASSWORD_MIN} символов.`;
  if (password.length > PASSWORD_MAX) return `Пароль должен быть не длиннее ${PASSWORD_MAX} символов.`;
  return null;
}

export function createAccounts(db, { issuer }) {
  const bySub = db.prepare("SELECT * FROM accounts WHERE sub = ?");
  const byEmail = db.prepare("SELECT * FROM accounts WHERE email = ?");
  const byLogin = db.prepare("SELECT * FROM accounts WHERE email = ? OR username = ?");
  const usernameTaken = db.prepare("SELECT 1 FROM accounts WHERE username = ? AND sub <> ?");
  const emailTaken = db.prepare("SELECT 1 FROM accounts WHERE email = ? AND sub <> ?");
  const insert = db.prepare(
    `INSERT INTO accounts (sub, email, username, display_name, password_hash) VALUES (?, ?, ?, ?, ?)`
  );
  const setHash = db.prepare("UPDATE accounts SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE sub = ?");
  const loginFailed = db.prepare(
    `UPDATE accounts SET failed_logins = failed_logins + 1,
       locked_until = CASE WHEN failed_logins + 1 >= ? THEN ? ELSE locked_until END
     WHERE sub = ?`
  );
  const loginOk = db.prepare("UPDATE accounts SET failed_logins = 0, locked_until = NULL WHERE sub = ?");
  const linkFor = db.prepare("SELECT platform_user_id FROM platform_links WHERE account_sub = ? AND platform = ?");
  const byIdentity = db.prepare(
    "SELECT accounts.* FROM external_identities JOIN accounts ON accounts.sub = external_identities.account_sub WHERE provider = ? AND provider_user_id = ?"
  );
  const insertIdentity = db.prepare("INSERT INTO external_identities (account_sub, provider, provider_user_id, email, display_name) VALUES (?, ?, ?, ?, ?)");

  function find(sub) {
    return bySub.get(sub) || null;
  }

  function avatarUrl(row) {
    return row.avatar_version ? `${issuer}/avatars/${row.sub}?v=${row.avatar_version}` : null;
  }

  /** Данные пользователя для ID token и userinfo. platform — сайт, который их запрашивает */
  function claimsFor(row, scope, platform) {
    const claims = { sub: row.sub };
    if (scope.has("email")) {
      claims.email = row.email;
      claims.email_verified = Boolean(row.email_verified_at);
    }
    if (scope.has("profile")) {
      claims.preferred_username = row.username;
      claims.name = row.display_name;
      const picture = avatarUrl(row);
      if (picture) claims.picture = picture;
      claims.updated_at = Math.floor(Date.parse(row.updated_at) / 1000);
      // Перенесённый аккаунт: номер старого пользователя на этом сайте, чтобы сайт связал его с sub
      const link = platform ? linkFor.get(row.sub, platform) : null;
      if (link) claims["https://endemion.online/legacy_user_id"] = link.platform_user_id;
    }
    return claims;
  }

  /**
   * Вход по почте или username. Время ответа одинаковое для несуществующего аккаунта и неверного пароля.
   * Результат: { account } при успехе, иначе { error: "invalid" | "locked" | "blocked" }
   */
  async function authenticate(login, password) {
    const value = String(login ?? "").trim();
    const row = byLogin.get(normalizeEmail(value), value) || null;
    if (!row) {
      await verifyPassword(String(password ?? ""), DUMMY_HASH);
      return { error: "invalid" };
    }
    if (row.locked_until && row.locked_until > Date.now()) {
      await verifyPassword(String(password ?? ""), DUMMY_HASH);
      return { error: "locked", account: row };
    }
    const { ok, rehash } = await verifyPassword(String(password ?? ""), row.password_hash);
    if (!ok) {
      loginFailed.run(LOCK_AFTER, Date.now() + LOCK_MS, row.sub);
      return { error: "invalid", account: row };
    }
    // Заблокированному об этом сообщаем только после верного пароля: иначе можно проверять чужие аккаунты
    if (row.status !== "active") return { error: "blocked", account: row };
    loginOk.run(row.sub);
    // Перенесённый хеш PBKDF2 (или scrypt со старыми параметрами) заменяется сразу после успешного входа
    if (rehash) setHash.run(await hashPassword(password), row.sub);
    return { account: find(row.sub) };
  }

  /** Новый аккаунт. Ошибка — { error, field } */
  async function register({ email, username, displayName, password }) {
    const cleanEmail = normalizeEmail(email);
    const cleanUsername = String(username ?? "").trim();
    const cleanName = normalizeName(displayName) || cleanUsername;
    const checks = [
      ["email", validateEmail(cleanEmail)],
      ["username", validateUsername(cleanUsername)],
      ["displayName", validateDisplayName(cleanName)],
      ["password", validatePassword(password)]
    ];
    for (const [field, error] of checks) if (error) return { error, field };

    const hash = await hashPassword(password);
    // Проверка занятости после хеширования: время ответа не выдаёт, зарегистрирована ли почта
    if (byEmail.get(cleanEmail)) return { error: "Аккаунт с этой почтой уже есть. Войдите или восстановите пароль.", field: "email" };
    if (usernameTaken.get(cleanUsername, "")) return { error: "Это имя пользователя занято.", field: "username" };
    const sub = randomUUID();
    try {
      insert.run(sub, cleanEmail, cleanUsername, cleanName, hash);
    } catch (err) {
      // Одновременная регистрация с той же почтой или именем: сработало ограничение UNIQUE
      if (String(err.message).includes("UNIQUE")) return { error: "Почта или имя пользователя уже заняты.", field: "email" };
      throw err;
    }
    return { account: find(sub) };
  }

  /**
   * Новый аккаунт для личности внешнего провайдера, без пароля. Аккаунт и связь создаются одной транзакцией.
   * Почта не считается подтверждённой: её подтверждает только письмо Endemion ID.
   * Занятая почта — { error, field: "email", conflict: true }: чужой аккаунт с ней не объединяется
   */
  function registerExternal({ email, username, displayName }, identity) {
    const cleanEmail = normalizeEmail(email);
    const cleanUsername = String(username ?? "").trim();
    const cleanName = normalizeName(displayName) || cleanUsername;
    const checks = [
      ["email", validateEmail(cleanEmail)],
      ["username", validateUsername(cleanUsername)],
      ["displayName", validateDisplayName(cleanName)]
    ];
    for (const [field, error] of checks) if (error) return { error, field };
    if (byEmail.get(cleanEmail)) return { error: "Аккаунт с этой почтой уже есть.", field: "email", conflict: true };
    if (usernameTaken.get(cleanUsername, "")) return { error: "Это имя пользователя занято.", field: "username" };
    const sub = randomUUID();
    try {
      transaction(db, () => {
        insert.run(sub, cleanEmail, cleanUsername, cleanName, NO_PASSWORD);
        insertIdentity.run(sub, identity.provider, identity.id, identity.email, identity.name);
      });
    } catch (err) {
      if (!String(err.message).includes("UNIQUE")) throw err;
      // Та же личность провайдера только что зарегистрировалась в другой вкладке
      if (byIdentity.get(identity.provider, identity.id)) return { error: "Этот аккаунт уже зарегистрирован. Войдите заново.", field: "email" };
      return { error: "Почта или имя пользователя уже заняты.", field: "email" };
    }
    return { account: find(sub) };
  }

  /** Аккаунт, к которому привязана личность провайдера, или null */
  function findByIdentity(provider, providerUserId) {
    return byIdentity.get(provider, providerUserId) || null;
  }

  function identities(sub) {
    return db.prepare("SELECT provider, email, display_name, linked_at, last_login_at FROM external_identities WHERE account_sub = ?").all(sub);
  }

  /** Привязать личность к аккаунту. Ошибка, если она уже у другого аккаунта или у этого аккаунта уже есть такой провайдер */
  function linkIdentity(sub, identity) {
    const owner = findByIdentity(identity.provider, identity.id);
    if (owner) return { error: owner.sub === sub ? "already" : "taken" };
    try {
      insertIdentity.run(sub, identity.provider, identity.id, identity.email, identity.name);
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) return { error: "provider_linked" };
      throw err;
    }
    return { ok: true };
  }

  function unlinkIdentity(sub, provider) {
    return db.prepare("DELETE FROM external_identities WHERE account_sub = ? AND provider = ?").run(sub, provider).changes > 0;
  }

  function touchIdentity(provider, providerUserId) {
    db.prepare("UPDATE external_identities SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE provider = ? AND provider_user_id = ?")
      .run(provider, providerUserId);
  }

  /** Изменение профиля. Почта меняется отдельно (с подтверждением), username и имя — здесь */
  function updateProfile(sub, { username, displayName }) {
    const row = find(sub);
    const cleanUsername = username === undefined ? row.username : String(username).trim();
    const cleanName = displayName === undefined ? row.display_name : normalizeName(displayName);
    const error = validateUsername(cleanUsername) || validateDisplayName(cleanName);
    if (error) return { error };
    if (usernameTaken.get(cleanUsername, sub)) return { error: "Это имя пользователя занято." };
    db.prepare(
      "UPDATE accounts SET username = ?, display_name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE sub = ?"
    ).run(cleanUsername, cleanName, sub);
    return { account: find(sub) };
  }

  function changeEmail(sub, email) {
    const cleanEmail = normalizeEmail(email);
    const error = validateEmail(cleanEmail);
    if (error) return { error };
    if (emailTaken.get(cleanEmail, sub)) return { error: "Эта почта уже используется другим аккаунтом." };
    db.prepare(
      "UPDATE accounts SET email = ?, email_verified_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE sub = ?"
    ).run(cleanEmail, sub);
    return { account: find(sub) };
  }

  async function setPassword(sub, password) {
    const error = validatePassword(password);
    if (error) return { error };
    setHash.run(await hashPassword(password), sub);
    loginOk.run(sub);
    return { ok: true };
  }

  async function checkPassword(sub, password) {
    const row = find(sub);
    return Boolean(row) && (await verifyPassword(String(password ?? ""), row.password_hash)).ok;
  }

  function markEmailVerified(sub) {
    db.prepare(
      "UPDATE accounts SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE sub = ? AND email_verified_at IS NULL"
    ).run(sub);
  }

  function setAvatarVersion(sub, version) {
    db.prepare("UPDATE accounts SET avatar_version = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE sub = ?").run(version, sub);
  }

  return {
    find,
    findByEmail: (email) => byEmail.get(normalizeEmail(email)) || null,
    avatarUrl,
    claimsFor,
    authenticate,
    register,
    registerExternal,
    findByIdentity,
    identities,
    linkIdentity,
    unlinkIdentity,
    touchIdentity,
    hasPassword: (row) => Boolean(row) && row.password_hash !== NO_PASSWORD,
    updateProfile,
    changeEmail,
    setPassword,
    checkPassword,
    markEmailVerified,
    setAvatarVersion
  };
}
