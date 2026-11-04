// ENDEMION ID: профили пользователей. Адрес публичного профиля — /users/<username>.
// Приватный профиль видят только владелец и модераторы; активность на форуме можно скрыть отдельно

import { USERNAME } from "./validate.js";

export const AVATAR_COLORS = ["violet", "blue", "pink", "teal", "amber", "crimson"];
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** Ключ аватара в хранилище картинок. Префикс avatars/ не пересекается с ключами страниц и обложек */
export function avatarKey(userId, version) {
  return `avatars/${userId}/${version}`;
}

export function avatarUrl(userId, version) {
  return version ? `/avatars/${userId}?v=${version}` : null;
}

/** Имя профиля из почты или имени: латиница, цифры и «_», от 3 до 24 символов */
export function usernameBase(email, name) {
  const fromEmail = String(email).split("@")[0].replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const fromName = String(name).replace(/[^a-zA-Z0-9_]/g, "");
  const base = (fromEmail.length >= 3 ? fromEmail : fromName.length >= 3 ? fromName : "reader").slice(0, 18);
  return USERNAME.test(base) ? base : "reader";
}

/** Создать профиль новому пользователю. Если имя занято, к нему добавляется id пользователя */
export async function createProfile(env, userId, email, name) {
  const base = usernameBase(email, name);
  for (const candidate of [base, `${base}${userId}`.slice(0, 24), `user${userId}`]) {
    const result = await env.DB.prepare("INSERT OR IGNORE INTO user_profiles (user_id, username) VALUES (?, ?)").bind(userId, candidate).run();
    if (result.meta.changes) return candidate;
  }
  throw new Error("Не удалось подобрать имя профиля");
}

const PROFILE_SELECT = `SELECT u.id, u.name, u.created_at, u.role, u.blocked_at, p.username, p.bio, p.avatar_version, p.avatar_color,
  p.is_public, p.show_library, p.show_activity, p.notify_chapters, p.notify_replies, p.notify_follows, p.notify_achievements
FROM users u JOIN user_profiles p ON p.user_id = u.id`;

export async function profileByUsername(env, username) {
  if (typeof username !== "string" || !USERNAME.test(username)) return null;
  return env.DB.prepare(`${PROFILE_SELECT} WHERE p.username = ? AND u.blocked_at IS NULL`).bind(username).first();
}

export async function profileByUserId(env, userId) {
  return env.DB.prepare(`${PROFILE_SELECT} WHERE u.id = ?`).bind(userId).first();
}

export function toProfile(row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    bio: row.bio,
    role: row.role,
    avatar: avatarUrl(row.id, row.avatar_version),
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
    isPublic: row.is_public === 1,
    showActivity: row.show_activity === 1
  };
}

export function toSettings(row) {
  return {
    username: row.username,
    bio: row.bio,
    avatarColor: row.avatar_color,
    isPublic: row.is_public === 1,
    showActivity: row.show_activity === 1,
    notify: {
      replies: row.notify_replies === 1,
      follows: row.notify_follows === 1,
      achievements: row.notify_achievements === 1
    }
  };
}

/** Активность в сообществе: темы, ответы, подписки, достижения */
export async function communityStats(env, userId) {
  return env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM threads WHERE user_id = ?1 AND deleted_at IS NULL) AS topics,
       (SELECT COUNT(*) FROM comments WHERE user_id = ?1 AND target_type = 'thread' AND deleted_at IS NULL) AS posts,
       (SELECT COUNT(*) FROM follows WHERE followee_id = ?1) AS followers,
       (SELECT COUNT(*) FROM follows WHERE follower_id = ?1) AS following,
       (SELECT COUNT(*) FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id
          WHERE ua.user_id = ?1 AND a.code IN ('voice_10', 'theorist', 'followed_5')) AS achievements`
  ).bind(userId).first();
}

/** Может ли viewer видеть профиль owner целиком */
export function canSeeProfile(row, viewer) {
  if (viewer && (viewer.id === row.id || viewer.isModerator)) return true;
  return row.is_public === 1;
}
