// Админка платформы: жанры, авторы, теги, персонажи и связи тайтлов, роли пользователей, подборки на главной, сводка.
// Только администратор: права проверяются в каждом обработчике. Каждый экспорт — маршрут, адреса в src/worker.js

import { confirmPassword, requireAdmin } from "../_lib/admin.js";
import { audit, titleLabel, userLabel } from "../_lib/audit.js";
import { error, json, readJson } from "../_lib/http.js";
import { ROLES } from "../_lib/roles.js";
import { listAuthors, listGenres, listTags } from "../_lib/taxonomy.js";
import { CHARACTER_ROLES, listCharacters, RELATION_KINDS, toCharacter } from "../_lib/titleExtras.js";
import { getTitle, parseId, searchColumns } from "../_lib/titles.js";
import { getAdminUser } from "../_lib/users.js";
import { cleanLine, cleanText, lengthProblem } from "../_lib/validate.js";

/** Обновить кеш-столбцы (titles.genres, titles.author и строки поиска) у тайтлов, где встречается жанр или автор */
async function refreshTitleCache(env, titleIds) {
  if (!titleIds.length) return;
  const statements = [];
  for (const id of titleIds) {
    const [{ results: genres }, { results: authors }] = await env.DB.batch([
      env.DB.prepare("SELECT g.name FROM title_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.title_id = ? ORDER BY tg.position").bind(id),
      env.DB.prepare("SELECT a.name FROM title_authors ta JOIN authors a ON a.id = ta.author_id WHERE ta.title_id = ? ORDER BY ta.position").bind(id)
    ]);
    const title = await getTitle(env, id);
    if (!title) continue;
    const updated = { ...title, genres: genres.map((row) => row.name), author: authors.map((row) => row.name).join(", ") || title.author };
    const search = searchColumns(updated);
    statements.push(env.DB.prepare(
      "UPDATE titles SET genres = ?, author = ?, search_text = ?, search_title = ?, search_author = ?, search_genres = ? WHERE id = ?"
    ).bind(JSON.stringify(updated.genres), updated.author, search.search_text, search.search_title, search.search_author, search.search_genres, id));
  }
  if (statements.length) await env.DB.batch(statements);
}

async function titlesWith(env, table, column, id) {
  const { results } = await env.DB.prepare(`SELECT title_id FROM ${table} WHERE ${column} = ?`).bind(id).all();
  return results.map((row) => row.title_id);
}

// ==================== ЖАНРЫ И АВТОРЫ ====================

/** Общий обработчик справочника: жанры (genres) и авторы (authors) устроены одинаково */
function dictionary({ table, link, column, label, maxName, textColumn, maxText, list, action }) {
  return {
    collection: {
      async onRequestGet({ request, env }) {
        const { response } = await requireAdmin(env, request);
        if (response) return response;
        return json({ items: await list(env) });
      },
      async onRequestPost({ request, env }) {
        const { user, response } = await requireAdmin(env, request);
        if (response) return response;
        const body = await readJson(request);
        const name = cleanLine(body?.name);
        const text = cleanText(body?.[textColumn] ?? "");
        const problem = lengthProblem(name, label, 1, maxName) || lengthProblem(text, "Описание", 0, maxText);
        if (problem) return error(problem);
        try {
          await env.DB.prepare(`INSERT INTO ${table} (name, ${textColumn}) VALUES (?, ?)`).bind(name, text).run();
        } catch (err) {
          if (String(err).includes("UNIQUE")) return error(`${label} «${name}» уже есть.`, 409);
          throw err;
        }
        await audit(env, user, `${action}.create`, `«${name}»`);
        return json({ items: await list(env) }, 201);
      }
    },
    item: {
      async onRequestPut({ request, env, params }) {
        const { user, response } = await requireAdmin(env, request);
        if (response) return response;
        const id = parseId(params.id);
        const row = id ? await env.DB.prepare(`SELECT name FROM ${table} WHERE id = ?`).bind(id).first() : null;
        if (!row) return error(`${label} не найден.`, 404);
        const body = await readJson(request);
        const name = cleanLine(body?.name);
        const text = cleanText(body?.[textColumn] ?? "");
        const problem = lengthProblem(name, label, 1, maxName) || lengthProblem(text, "Описание", 0, maxText);
        if (problem) return error(problem);
        try {
          await env.DB.prepare(`UPDATE ${table} SET name = ?, ${textColumn} = ? WHERE id = ?`).bind(name, text, id).run();
        } catch (err) {
          if (String(err).includes("UNIQUE")) return error(`${label} «${name}» уже есть.`, 409);
          throw err;
        }
        if (name !== row.name) await refreshTitleCache(env, await titlesWith(env, link, column, id));
        await audit(env, user, `${action}.update`, `«${row.name}» → «${name}»`);
        return json({ items: await list(env) });
      },
      async onRequestDelete({ request, env, params }) {
        const { user, response } = await requireAdmin(env, request);
        if (response) return response;
        const id = parseId(params.id);
        const row = id ? await env.DB.prepare(`SELECT name FROM ${table} WHERE id = ?`).bind(id).first() : null;
        if (!row) return error(`${label} не найден.`, 404);
        const used = await titlesWith(env, link, column, id);
        if (used.length) return error(`${label} указан у ${used.length} тайтлов. Сначала уберите его из карточек.`, 409);
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
        await audit(env, user, `${action}.delete`, `«${row.name}»`);
        return json({ items: await list(env) });
      }
    }
  };
}

const genres = dictionary({
  table: "genres", link: "title_genres", column: "genre_id", label: "Жанр", maxName: 30, textColumn: "description", maxText: 500,
  list: listGenres, action: "genre"
});
const authors = dictionary({
  table: "authors", link: "title_authors", column: "author_id", label: "Автор", maxName: 120, textColumn: "bio", maxText: 1000,
  list: listAuthors, action: "author"
});
export const adminGenres = genres.collection;
export const adminGenre = genres.item;
export const adminAuthors = authors.collection;
export const adminAuthor = authors.item;

/** GET /api/admin/tags — все теги с числом тайтлов (для формы тайтла) */
export const adminTags = {
  async onRequestGet({ request, env }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    return json({ tags: await listTags(env) });
  }
};

// ==================== ПЕРСОНАЖИ И СВЯЗИ ====================

function parseCharacter(body) {
  const name = cleanLine(body?.name);
  const description = cleanText(body?.description ?? "");
  const symbol = cleanLine(body?.symbol ?? "✦");
  const problem = lengthProblem(name, "Имя персонажа", 1, 80) || lengthProblem(description, "Описание", 0, 500) ||
    lengthProblem(symbol, "Символ", 1, 3);
  if (problem) return { problem };
  if (!CHARACTER_ROLES[body.role]) return { problem: "Выберите роль персонажа." };
  return { character: { name, description, symbol, role: body.role } };
}

/** /api/admin/titles/:id/characters — персонажи тайтла (GET) и новый персонаж (POST) */
export const adminCharacters = {
  async onRequestGet({ request, env, params }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    const id = parseId(params.id);
    if (!id || !(await getTitle(env, id))) return error("Тайтл не найден.", 404);
    return json({ characters: await listCharacters(env, id) });
  },
  async onRequestPost({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const title = id ? await getTitle(env, id) : null;
    if (!title) return error("Тайтл не найден.", 404);
    const { character, problem } = parseCharacter(await readJson(request));
    if (problem) return error(problem);
    try {
      await env.DB.prepare("INSERT INTO characters (title_id, name, role, description, symbol) VALUES (?, ?, ?, ?, ?)")
        .bind(id, character.name, character.role, character.description, character.symbol).run();
    } catch (err) {
      if (String(err).includes("UNIQUE")) return error("Такой персонаж уже есть.", 409);
      throw err;
    }
    await audit(env, user, "character.create", `${titleLabel(title)}, ${character.name}`);
    return json({ characters: await listCharacters(env, id) }, 201);
  }
};

/** /api/admin/characters/:id — изменить или удалить персонажа */
export const adminCharacter = {
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT * FROM characters WHERE id = ?").bind(id).first() : null;
    if (!row) return error("Персонаж не найден.", 404);
    const { character, problem } = parseCharacter(await readJson(request));
    if (problem) return error(problem);
    try {
      await env.DB.prepare("UPDATE characters SET name = ?, role = ?, description = ?, symbol = ? WHERE id = ?")
        .bind(character.name, character.role, character.description, character.symbol, id).run();
    } catch (err) {
      if (String(err).includes("UNIQUE")) return error("Такой персонаж уже есть.", 409);
      throw err;
    }
    await audit(env, user, "character.update", `#${id} ${character.name}`);
    return json({ character: toCharacter({ ...row, ...character }) });
  },
  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT name FROM characters WHERE id = ?").bind(id).first() : null;
    if (!row) return error("Персонаж не найден.", 404);
    // Варианты голосований и участники турниров остаются: у них сохранена подпись
    await env.DB.prepare("DELETE FROM characters WHERE id = ?").bind(id).run();
    await audit(env, user, "character.delete", `#${id} ${row.name}`);
    return json({ ok: true });
  }
};

/** PUT /api/admin/titles/:id/relations — заменить связи тайтла: [{ titleId, kind }] */
export const adminRelations = {
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const title = id ? await getTitle(env, id) : null;
    if (!title) return error("Тайтл не найден.", 404);
    const body = await readJson(request);
    const relations = Array.isArray(body?.relations) ? body.relations : null;
    if (!relations || relations.length > 30) return error("Связей: не больше 30.");
    for (const relation of relations) {
      if (!Number.isInteger(relation?.titleId) || relation.titleId === id) return error("Некорректный тайтл в связях.");
      if (!RELATION_KINDS[relation.kind]) return error("Неизвестный вид связи.");
      if (!(await getTitle(env, relation.titleId))) return error(`Тайтл #${relation.titleId} не найден.`, 404);
    }
    const unique = [...new Map(relations.map((relation) => [relation.titleId, relation])).values()];
    // Связь хранится в одну сторону: обратные записи удаляются, чтобы не было двух разных видов для одной пары
    await env.DB.batch([
      env.DB.prepare("DELETE FROM title_relations WHERE title_id = ?").bind(id),
      ...unique.map((relation) => env.DB.prepare("DELETE FROM title_relations WHERE title_id = ? AND related_id = ?").bind(relation.titleId, id)),
      ...unique.map((relation) => env.DB.prepare("INSERT INTO title_relations (title_id, related_id, kind) VALUES (?, ?, ?)").bind(id, relation.titleId, relation.kind))
    ]);
    await audit(env, user, "title.relations", titleLabel(title));
    return json({ ok: true });
  }
};

// ==================== РОЛИ ====================

/**
 * PUT /api/admin/users/:id/role { role, password } — назначить роль user, moderator или admin.
 * Нужен пароль администратора: украденная сессия без пароля роль не выдаст
 */
export const adminUserRole = {
  async onRequestPut({ request, env, params }) {
    const { user: admin, response } = await requireAdmin(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const target = id ? await getAdminUser(env, id) : null;
    if (!target) return error("Пользователь не найден.", 404);
    if (target.id === admin.id) return error("Свою роль изменить нельзя.", 409);
    const body = await readJson(request);
    if (!body || !ROLES.includes(body.role)) return error("Роль: user, moderator или admin.");
    if (target.blockedAt && body.role !== "user") return error("Сначала разблокируйте пользователя.", 409);
    if (target.role === body.role) return error("У пользователя уже эта роль.", 409);
    const denied = await confirmPassword(env, request, admin, body.password);
    if (denied) return denied;
    await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(body.role, target.id).run();
    await audit(env, admin, `user.role.${body.role}`, userLabel(target));
    return json({ user: await getAdminUser(env, target.id) });
  }
};

// ==================== ПОДБОРКИ ====================

/** GET /api/admin/collections — все подборки, в том числе скрытые */
export const adminCollections = {
  async onRequestGet({ request, env }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.name, c.is_public, c.featured, c.hidden_at, c.updated_at, u.name AS author,
         (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS size
       FROM collections c JOIN users u ON u.id = c.user_id ORDER BY c.featured DESC, c.updated_at DESC LIMIT 200`
    ).all();
    return json({
      collections: results.map((row) => ({
        id: row.id, name: row.name, isPublic: row.is_public === 1, featured: row.featured === 1, hidden: row.hidden_at !== null,
        updatedAt: row.updated_at, author: row.author, size: row.size
      }))
    });
  }
};

/** PUT /api/admin/collections/:id { featured, hidden } — показать подборку на главной или скрыть */
export const adminCollection = {
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT name, is_public FROM collections WHERE id = ?").bind(id).first() : null;
    if (!row) return error("Подборка не найдена.", 404);
    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");
    if ("featured" in body) {
      if (typeof body.featured !== "boolean") return error("Некорректное значение.");
      if (body.featured && row.is_public !== 1) return error("На главную можно вынести только открытую подборку.", 409);
      await env.DB.prepare("UPDATE collections SET featured = ? WHERE id = ?").bind(body.featured ? 1 : 0, id).run();
    }
    if ("hidden" in body) {
      if (typeof body.hidden !== "boolean") return error("Некорректное значение.");
      await env.DB.prepare(`UPDATE collections SET hidden_at = ${body.hidden ? "datetime('now')" : "NULL"}${body.hidden ? ", featured = 0" : ""} WHERE id = ?`).bind(id).run();
    }
    await audit(env, user, "collection.update", `«${row.name}» (#${id})`);
    return json({ ok: true });
  }
};

// ==================== СВОДКА ПЛАТФОРМЫ ====================

/** GET /api/admin/platform-stats — сообщество, Арена, чтение: для первого экрана админки */
export const adminPlatformStats = {
  async onRequestGet({ request, env }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    const row = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM reviews) AS reviews,
         (SELECT COUNT(*) FROM comments WHERE deleted_at IS NULL) AS comments,
         (SELECT COUNT(*) FROM comments WHERE deleted_at IS NULL AND created_at >= datetime('now', '-7 days')) AS comments_week,
         (SELECT COUNT(*) FROM threads WHERE deleted_at IS NULL) AS threads,
         (SELECT COUNT(*) FROM collections) AS collections,
         (SELECT COUNT(*) FROM follows) AS follows,
         (SELECT COUNT(*) FROM polls WHERE status = 'open') AS polls_open,
         (SELECT COUNT(*) FROM votes) + (SELECT COUNT(*) FROM tournament_votes) AS votes,
         (SELECT COUNT(*) FROM tournaments) AS tournaments,
         (SELECT COUNT(DISTINCT target_type || ':' || target_id) FROM reports WHERE status = 'open') AS reports_open,
         (SELECT COUNT(*) FROM library) AS library,
         (SELECT COALESCE(SUM(chapter), 0) FROM library) AS chapters_read,
         (SELECT COUNT(*) FROM genres) AS genres,
         (SELECT COUNT(*) FROM authors) AS authors,
         (SELECT COUNT(*) FROM characters) AS characters,
         (SELECT COUNT(*) FROM users WHERE muted_until > datetime('now')) AS muted`
    ).first();
    const { results: topTitles } = await env.DB.prepare(
      `SELECT t.id, t.title, COUNT(l.user_id) AS readers FROM titles t JOIN library l ON l.title_id = t.id
       GROUP BY t.id ORDER BY readers DESC LIMIT 5`
    ).all();
    return json({ ...row, topTitles });
  }
};
