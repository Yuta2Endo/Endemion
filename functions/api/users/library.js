// Избранные игры пользователя: GET список, POST добавить, DELETE убрать.
// Доступно только владельцу профиля. Маршруты регистрируются в src/worker.js.

import { error, json, readJson } from "../../_lib/http.js";
import { currentUser } from "../../_lib/session.js";
import { takeAction } from "../../_lib/limits.js";
import { addGameFavorite, listGameLibrary, removeGameFavorite } from "../../_lib/studio.js";
import { parseId } from "../../_lib/validate.js";
import { profileByUsername } from "../../_lib/profiles.js";

/** Проверка, что запрашиваемый пользователь — текущий вошедший */
async function loadOwnProfile(env, request, params) {
  const viewer = await currentUser(env, request);
  if (!viewer) return { response: error("Войдите в профиль.", 401) };
  const profileRow = await profileByUsername(env, params.username);
  if (!profileRow) return { response: error("Профиль не найден.", 404) };
  if (viewer.id !== profileRow.id) return { response: error("Нельзя изменять чужой список избранного.", 403) };
  return { viewer };
}

/** GET /api/users/:username/library — любимые игры текущего пользователя */
export const userLibrary = {
  async onRequestGet({ request, env, params }) {
    const { viewer, response } = await loadOwnProfile(env, request, params);
    if (response) return response;
    const games = await listGameLibrary(env, viewer.id);
    return json({ games });
  }
};

/** POST /api/users/:username/library — добавить игру в избранное. Тело: { game_id } */
export const userLibraryAdd = {
  async onRequestPost({ request, env, params }) {
    const { viewer, response } = await loadOwnProfile(env, request, params);
    if (response) return response;

    const limited = await takeAction(env, viewer.id, "follow");
    if (limited) return limited;

    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");
    const gameId = parseId(body.game_id);
    if (!gameId) return error("Укажите игру.", 400);

    // Игра должна существовать и быть опубликованной
    const game = await env.DB.prepare("SELECT id FROM games WHERE id = ? AND published = 1").bind(gameId).first();
    if (!game) return error("Игра не найдена.", 404);

    const added = await addGameFavorite(env, viewer.id, gameId);
    return json({ added, favorited: true });
  }
};

/** DELETE /api/users/:username/library/:game_id — убрать из избранного */
export const userLibraryRemove = {
  async onRequestDelete({ request, env, params }) {
    const { viewer, response } = await loadOwnProfile(env, request, params);
    if (response) return response;

    const gameId = parseId(params.game_id);
    if (!gameId) return error("Некорректный идентификатор игры.", 400);

    const removed = await removeGameFavorite(env, viewer.id, gameId);
    return json({ removed, favorited: false });
  }
};
