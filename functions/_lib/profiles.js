// ENDEMION ID: профили пользователей. Адрес публичного профиля — /users/<username>.
// Приватный профиль видят только владелец и модераторы; полку и активность можно скрыть отдельно

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
    showLibrary: row.show_library === 1,
    showActivity: row.show_activity === 1
  };
}

export function toSettings(row) {
  return {
    username: row.username,
    bio: row.bio,
    avatarColor: row.avatar_color,
    isPublic: row.is_public === 1,
    showLibrary: row.show_library === 1,
    showActivity: row.show_activity === 1,
    notify: {
      chapters: row.notify_chapters === 1,
      replies: row.notify_replies === 1,
      follows: row.notify_follows === 1,
      achievements: row.notify_achievements === 1
    }
  };
}

/** Статистика чтения: полка по статусам, главы, оценки, комментарии, подписки */
export async function readingStats(env, userId) {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM library WHERE user_id = ?1) AS library,
       (SELECT COALESCE(SUM(favorite), 0) FROM library WHERE user_id = ?1) AS favorites,
       (SELECT COUNT(*) FROM library WHERE user_id = ?1 AND status = 'reading') AS reading,
       (SELECT COUNT(*) FROM library WHERE user_id = ?1 AND status = 'planned') AS planned,
       (SELECT COUNT(*) FROM library WHERE user_id = ?1 AND status = 'completed') AS completed,
       (SELECT COUNT(*) FROM library WHERE user_id = ?1 AND status = 'on_hold') AS on_hold,
       (SELECT COUNT(*) FROM library WHERE user_id = ?1 AND status = 'dropped') AS dropped,
       (SELECT COALESCE(SUM(chapter), 0) FROM library WHERE user_id = ?1) AS chapters,
       (SELECT COUNT(*) FROM reviews WHERE user_id = ?1) AS reviews,
       (SELECT ROUND(AVG(score), 1) FROM reviews WHERE user_id = ?1) AS average_score,
       (SELECT COUNT(*) FROM comments WHERE user_id = ?1 AND deleted_at IS NULL) AS comments,
       (SELECT COUNT(*) FROM follows WHERE followee_id = ?1) AS followers,
       (SELECT COUNT(*) FROM follows WHERE follower_id = ?1) AS following,
       (SELECT COUNT(*) FROM user_achievements WHERE user_id = ?1) AS achievements`
  ).bind(userId).first();
  const { results: genres } = await env.DB.prepare(
    `SELECT g.name, COUNT(*) AS n FROM library l JOIN title_genres tg ON tg.title_id = l.title_id JOIN genres g ON g.id = tg.genre_id
     WHERE l.user_id = ? AND (l.status IS NULL OR l.status <> 'dropped') GROUP BY g.id ORDER BY n DESC, g.name LIMIT 6`
  ).bind(userId).all();
  const { results: types } = await env.DB.prepare(
    "SELECT t.type, COUNT(*) AS n FROM library l JOIN titles t ON t.id = l.title_id WHERE l.user_id = ? GROUP BY t.type"
  ).bind(userId).all();
  return {
    ...row,
    onHold: row.on_hold,
    averageScore: row.average_score,
    topGenres: genres.map((genre) => ({ name: genre.name, count: genre.n })),
    types: Object.fromEntries(types.map((type) => [type.type, type.n]))
  };
}

/** Любимые жанры, которые пользователь выбрал сам */
export async function favoriteGenres(env, userId) {
  const { results } = await env.DB.prepare(
    "SELECT g.name FROM user_genres ug JOIN genres g ON g.id = ug.genre_id WHERE ug.user_id = ? ORDER BY g.name"
  ).bind(userId).all();
  return results.map((row) => row.name);
}

/** Может ли viewer видеть профиль owner целиком */
export function canSeeProfile(row, viewer) {
  if (viewer && (viewer.id === row.id || viewer.isModerator)) return true;
  return row.is_public === 1;
}
