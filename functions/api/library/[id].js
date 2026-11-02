// PUT /api/library/:id — изменить запись библиотеки: избранное, статус, прочитанные главы.
// Передаются только изменяемые поля, остальные остаются прежними

import { checkAchievements } from "../../_lib/achievements.js";
import { error, json, readJson } from "../../_lib/http.js";
import { currentUser } from "../../_lib/session.js";
import { getTitle, parseId } from "../../_lib/titles.js";
import { STATUSES } from "../../_lib/validate.js";

export async function onRequestPut({ request, env, params }) {
  const user = await currentUser(env, request);
  if (!user) return error("Войдите в профиль.", 401);

  const id = parseId(params.id);
  const title = id ? await getTitle(env, id) : null;
  if (!title) return error("Тайтл не найден.", 404);

  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");

  const current = await env.DB.prepare("SELECT favorite, status, chapter FROM library WHERE user_id = ? AND title_id = ?")
    .bind(user.id, id).first() || { favorite: 0, status: null, chapter: 0 };

  let favorite = current.favorite;
  let status = current.status;
  let chapter = current.chapter;

  if ("favorite" in body) {
    if (typeof body.favorite !== "boolean") return error("Некорректное значение избранного.");
    favorite = body.favorite ? 1 : 0;
  }
  if ("status" in body) {
    if (body.status !== null && !STATUSES.includes(body.status)) return error("Неизвестный статус.");
    status = body.status;
  }
  if ("chapter" in body) {
    // Нельзя отметить больше глав, чем уже вышло
    if (!Number.isInteger(body.chapter) || body.chapter < 0 || body.chapter > title.chapters) {
      return error(`Глава должна быть от 0 до ${title.chapters}.`);
    }
    chapter = body.chapter;
    // Отметил главу — значит читает (если не выбрал другой статус в этом же запросе);
    // дочитал завершённый тайтл до конца — прочитано
    if (chapter > 0 && (status === null || status === "planned") && !("status" in body)) status = "reading";
    if (chapter === title.chapters && chapter > 0 && title.status === "completed") status = "completed";
  }

  if (!favorite && status === null && chapter === 0) {
    // Пустая запись не нужна
    await env.DB.prepare("DELETE FROM library WHERE user_id = ? AND title_id = ?").bind(user.id, id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO library (user_id, title_id, favorite, status, chapter, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (user_id, title_id) DO UPDATE SET
         favorite = excluded.favorite, status = excluded.status, chapter = excluded.chapter, updated_at = excluded.updated_at`
    ).bind(user.id, id, favorite, status, chapter).run();
  }

  const achievements = await checkAchievements(env, user.id, "library");
  return json({ item: { titleId: id, favorite: favorite === 1, status, chapter }, achievements });
}
