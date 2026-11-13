// /api/me/onboarding — чек-лист первого входа в панели аккаунта.
// Шаги не хранятся отдельно: считаем их по фактическим данным, поэтому подсказка
// всегда честная, а «скрыть» запоминается в user_profiles.onboarding_hidden.

import { error, json, readJson } from "../../_lib/http.js";
import { currentUser } from "../../_lib/session.js";

/** Шаги в том порядке, в котором их показываем; подписи и ссылки — на клиенте */
export const STEPS = ["avatar", "bio", "game", "topic"];

export async function onRequestGet({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return error("Войдите в аккаунт.", 401);

  const [profileResult, gameResult, topicResult] = await env.DB.batch([
    env.DB.prepare("SELECT avatar_version, bio, onboarding_hidden FROM user_profiles WHERE user_id = ?").bind(user.id),
    env.DB.prepare("SELECT 1 AS found FROM game_library WHERE user_id = ? LIMIT 1").bind(user.id),
    env.DB.prepare("SELECT 1 AS found FROM threads WHERE user_id = ? AND deleted_at IS NULL LIMIT 1").bind(user.id)
  ]);

  const profile = profileResult.results[0] || {};
  const done = {
    avatar: Boolean(profile.avatar_version),
    bio: Boolean(profile.bio && String(profile.bio).trim()),
    game: Boolean(gameResult.results[0]),
    topic: Boolean(topicResult.results[0])
  };

  const steps = STEPS.map((key) => ({ key, done: done[key] }));
  return json({
    steps,
    done: steps.filter((step) => step.done).length,
    total: steps.length,
    hidden: Boolean(profile.onboarding_hidden)
  });
}

/** Скрыть чек-лист: пользователь решил, что подсказки ему не нужны */
export async function onRequestPatch({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return error("Войдите в аккаунт.", 401);

  const body = await readJson(request);
  if (!body || typeof body.hidden !== "boolean") return error("Неверные данные.");
  if (!body.hidden) return error("Отменить скрытие нельзя через этот запрос.");

  await env.DB.prepare("UPDATE user_profiles SET onboarding_hidden = 1 WHERE user_id = ?").bind(user.id).run();
  return json({ ok: true, hidden: true });
}
