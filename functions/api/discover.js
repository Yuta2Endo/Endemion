// ENDEMION NEXUS (граф связей), ORACLE (рекомендации) и данные главной страницы.
// Каждый экспорт — маршрут, адреса перечислены в src/worker.js

import { error, json } from "../_lib/http.js";
import { takeAction } from "../_lib/limits.js";
import { buildGraph, compactTitle, loadFeatures, relatedTitles } from "../_lib/nexus.js";
import { MOOD_KEYS, MOODS, personalPicks, recommend } from "../_lib/oracle.js";
import { currentUser } from "../_lib/session.js";
import { listGenres, listTags, TAG_CATEGORIES, titleTags } from "../_lib/taxonomy.js";
import { listCharacters, listRelations, listSources, RELATION_KINDS, SOURCE_KINDS, CHARACTER_ROLES } from "../_lib/titleExtras.js";
import { getTitle, getTitlesByIds, parseId, searchTitles, TYPES } from "../_lib/titles.js";
import { intParam } from "../_lib/validate.js";

const FOCUS = ["genre", "mood", "hero", "plot", "theme", "setting", "author"];

/**
 * GET /api/nexus/:id — граф связей вокруг тайтла. focus — искать связи по одной категории
 * (жанр, атмосфера, герой, сюжет, темы, мир, автор), depth 1 или 2
 */
export const nexusGraph = {
  async onRequestGet({ request, env, params }) {
    const id = parseId(params.id);
    if (!id) return error("Тайтл не найден.", 404);
    const search = new URL(request.url).searchParams;
    const focus = search.get("focus") || null;
    if (focus && !FOCUS.includes(focus)) return error("Неизвестная категория связи.");
    const depth = intParam(search.get("depth"), 2, 1, 2);
    if (depth === null) return error("depth: 1 или 2.");
    const features = await loadFeatures(env);
    const graph = buildGraph(features, id, { depth, focus });
    if (!graph) return error("Тайтл не найден.", 404);
    return json({ graph, categories: TAG_CATEGORIES }, 200, { "Cache-Control": "public, max-age=60" });
  }
};

/** GET /api/titles/:id/related — похожие тайтлы с объяснением, почему они связаны */
export const titleRelated = {
  async onRequestGet({ request, env, params }) {
    const id = parseId(params.id);
    if (!id) return error("Тайтл не найден.", 404);
    const search = new URL(request.url).searchParams;
    const focus = search.get("focus") || null;
    if (focus && !FOCUS.includes(focus)) return error("Неизвестная категория связи.");
    const limit = intParam(search.get("limit"), 8, 1, 24);
    if (limit === null) return error("Некорректный limit.");
    const features = await loadFeatures(env);
    if (!features.byId.has(id)) return error("Тайтл не найден.", 404);
    const items = relatedTitles(features, id, { limit, focus }).map((item) => ({ title: compactTitle(item.title), score: item.score, reasons: item.reasons }));
    return json({ items }, 200, { "Cache-Control": "public, max-age=60" });
  }
};

/** GET /api/titles/:id/details — теги, персонажи, легальные источники и связи тайтла */
export const titleDetails = {
  async onRequestGet({ env, params }) {
    const id = parseId(params.id);
    const title = id ? await getTitle(env, id) : null;
    if (!title) return error("Тайтл не найден.", 404);
    const [tags, characters, sources, relations] = await Promise.all([
      titleTags(env, id), listCharacters(env, id), listSources(env, id), listRelations(env, id)
    ]);
    const related = await getTitlesByIds(env, relations.map((row) => row.id));
    const kinds = new Map(relations.map((row) => [row.id, row.kind]));
    return json({
      title,
      tags,
      characters,
      sources: sources.map((source) => ({ ...source, kindLabel: SOURCE_KINDS[source.kind] })),
      relations: related.map((item) => ({ title: compactTitle(item), kind: kinds.get(item.id), label: RELATION_KINDS[kinds.get(item.id)] })),
      roles: CHARACTER_ROLES
    }, 200, { "Cache-Control": "public, max-age=60" });
  }
};

/** GET /api/taxonomy — жанры, теги по категориям, типы: для фильтров, Nexus и Oracle */
export const taxonomy = {
  async onRequestGet({ env }) {
    const [genres, tags] = await Promise.all([listGenres(env), listTags(env)]);
    return json({
      genres: genres.filter((genre) => genre.titles > 0),
      tags,
      categories: TAG_CATEGORIES,
      types: Object.fromEntries(Object.entries(TYPES).map(([key, value]) => [key, value.label]))
    }, 200, { "Cache-Control": "public, max-age=300" });
  }
};

/** GET /api/oracle — список настроений */
export const oracleMoods = {
  async onRequestGet() {
    return json({ moods: MOOD_KEYS.map((key) => ({ key, label: MOODS[key].label, needsTitle: key === "similar" })) }, 200,
      { "Cache-Control": "public, max-age=3600" });
  }
};

/**
 * GET /api/oracle/:mood — рекомендации по настроению. title — для «похожего», type — только манга/манхва/маньхуа,
 * seen=1 — показывать и то, что уже на полке
 */
export const oracleRecommend = {
  async onRequestGet({ request, env, params }) {
    const mood = params.mood;
    if (!MOODS[mood]) return error("Неизвестное настроение.", 404);
    const search = new URL(request.url).searchParams;
    const titleId = search.get("title") ? parseId(search.get("title")) : null;
    if (mood === "similar") {
      if (!titleId || !(await getTitle(env, titleId))) return error("Выберите произведение, на которое должно быть похоже.");
    }
    const type = search.get("type") || null;
    if (type && !TYPES[type]) return error("Неизвестный тип.");
    const limit = intParam(search.get("limit"), 12, 1, 30);
    if (limit === null) return error("Некорректный limit.");
    const user = await currentUser(env, request);
    if (user) {
      const limited = await takeAction(env, user.id, "oracle");
      if (limited) return limited;
    }
    const result = await recommend(env, { userId: user?.id ?? null, mood, titleId, limit, type, excludeSeen: search.get("seen") !== "1" });
    return json({
      ...result,
      items: result.items.map((item) => ({ title: compactTitle(item.title), score: item.score, reasons: item.reasons }))
    });
  }
};

/**
 * GET /api/home — данные главной: популярное, новинки, недавно обновлённые, подборки по настроению, подборки читателей.
 * Для вошедших ещё «Продолжить чтение» делает /api/continue, а персональные рекомендации — поле forYou
 */
export const home = {
  async onRequestGet({ request, env }) {
    const user = await currentUser(env, request);
    const [popular, fresh, updated, topRated, featured] = await Promise.all([
      searchTitles(env, { order: "popular", limit: 10 }),
      searchTitles(env, { order: "new", limit: 10 }),
      searchTitles(env, { order: "updated", limit: 10 }),
      searchTitles(env, { order: "rating", limit: 10 }),
      env.DB.prepare(
        `SELECT c.id, c.name, c.description, u.name AS author_name, p.username AS author_username,
           (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS size,
           (SELECT json_group_array(title_id) FROM (SELECT title_id FROM collection_items WHERE collection_id = c.id ORDER BY position LIMIT 4)) AS preview
         FROM collections c JOIN users u ON u.id = c.user_id LEFT JOIN user_profiles p ON p.user_id = c.user_id
         WHERE c.is_public = 1 AND c.hidden_at IS NULL AND (c.featured = 1 OR (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) >= 3)
         ORDER BY c.featured DESC, c.updated_at DESC LIMIT 6`
      ).all()
    ]);

    // Подборки по настроению: по 6 тайтлов, без учёта полки (одинаково для всех). Каталог загружается один раз
    const features = await loadFeatures(env);
    const moodKeys = ["dark", "romance", "adventure", "strong_hero"];
    const moods = await Promise.all(moodKeys.map(async (key) => {
      const result = await recommend(env, { mood: key, limit: 6, excludeSeen: false, features });
      return { key, label: MOODS[key].label, titles: result.items.map((item) => compactTitle(item.title)) };
    }));

    const previewIds = featured.results.flatMap((row) => JSON.parse(row.preview || "[]"));
    const previews = new Map((await getTitlesByIds(env, previewIds)).map((title) => [title.id, compactTitle(title)]));
    const forYou = user ? await personalPicks(env, user.id, 10, features) : { personalized: false, items: [] };

    return json({
      popular: popular.titles,
      fresh: fresh.titles,
      updated: updated.titles.filter((title) => title.chapters > 0),
      topRated: topRated.titles,
      moods: moods.filter((mood) => mood.titles.length),
      collections: featured.results.map((row) => ({
        id: row.id, name: row.name, description: row.description, size: row.size,
        author: { name: row.author_name, username: row.author_username },
        preview: JSON.parse(row.preview || "[]").map((id) => previews.get(id)).filter(Boolean)
      })),
      forYou: { personalized: forYou.personalized, items: forYou.items.map((item) => ({ title: compactTitle(item.title), reasons: item.reasons })) },
      total: popular.total
    });
  }
};

/** GET /api/random — случайный тайтл для кнопки «Открой свою следующую историю». exclude — не с полки пользователя */
export const randomTitle = {
  async onRequestGet({ request, env }) {
    const user = await currentUser(env, request);
    const row = await env.DB.prepare(
      `SELECT id FROM titles t WHERE ? = 0 OR NOT EXISTS (SELECT 1 FROM library l WHERE l.title_id = t.id AND l.user_id = ?)
       ORDER BY random() LIMIT 1`
    ).bind(user ? 1 : 0, user?.id ?? 0).first() || await env.DB.prepare("SELECT id FROM titles ORDER BY random() LIMIT 1").first();
    if (!row) return error("Каталог пока пуст.", 404);
    return json({ title: await getTitle(env, row.id) });
  }
};
