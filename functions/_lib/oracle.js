// ENDEMION ORACLE: рекомендации по настроению, вкусу пользователя и истории чтения.
// Внешний ИИ не используется: оценка складывается из тегов и жанров тайтла, профиля вкуса пользователя
// (любимые жанры, что он дочитал, добавил в избранное, оценил и бросил) и сходства с выбранным тайтлом (Nexus).
// У каждой рекомендации есть объяснение: какие признаки сработали

import { loadFeatures, similarity } from "./nexus.js";

/**
 * Настроения. tags и genres — что ищем (вес признака), boost — дополнительное условие по данным тайтла
 */
export const MOODS = {
  strong_hero: {
    label: "Хочу сильного главного героя",
    tags: { "hero-overpowered": 3, "hero-growth": 2.5, "hero-genius": 2, "hero-female": 1.5, "plot-leveling": 1.5, "theme-power": 1 },
    genres: { "Экшен": 1.5, "Боевые искусства": 1.5 }
  },
  dark: {
    label: "Хочу мрачную историю",
    tags: { "mood-dark": 3, "mood-tragic": 2, "mood-tense": 2, "plot-survival": 1.5, "setting-postapoc": 1.5, "theme-loss": 1, "hero-antihero": 1 },
    genres: { "Ужасы": 2, "Триллер": 1.5, "Психология": 1.5 }
  },
  romance: {
    label: "Хочу романтику",
    tags: { "theme-love": 3, "plot-slowburn": 2, "mood-warm": 1.5, "mood-cozy": 1 },
    genres: { "Романтика": 3, "Сёдзё": 1, "Драма": 0.5 }
  },
  adventure: {
    label: "Хочу приключения",
    tags: { "plot-journey": 3, "setting-other-world": 2, "setting-dungeon": 2, "mood-epic": 2, "hero-ensemble": 1, "theme-friendship": 1 },
    genres: { "Приключения": 3, "Фэнтези": 1.5 }
  },
  twist: {
    label: "Хочу неожиданную концовку",
    tags: { "plot-twist": 3, "mood-mysterious": 2, "plot-mystery": 2, "plot-time-loop": 2, "hero-villain": 1 },
    genres: { "Детектив": 2, "Триллер": 1.5, "Психология": 1 },
    // Неожиданную концовку можно оценить только у завершённой истории
    completedBonus: 1.5
  },
  similar: {
    label: "Хочу что-то похожее на выбранное произведение",
    tags: {},
    genres: {}
  },
  hidden_gem: {
    label: "Хочу малоизвестную жемчужину",
    tags: {},
    genres: {}
  }
};

export const MOOD_KEYS = Object.keys(MOODS);

// Вес статуса полки в профиле вкуса: дочитанное и избранное говорит о вкусе больше, брошенное — против
const SHELF_WEIGHT = { completed: 2, reading: 1.5, on_hold: 0.5, planned: 0.7, dropped: -1.5 };

/** Профиль вкуса пользователя: веса жанров и тегов по его полке, оценкам и выбранным любимым жанрам */
export async function tasteProfile(env, userId) {
  const empty = { genres: new Map(), tags: new Map(), seen: new Set(), size: 0 };
  if (!userId) return empty;
  const [library, reviews, favoriteGenres] = await env.DB.batch([
    env.DB.prepare("SELECT title_id, favorite, status, chapter FROM library WHERE user_id = ?").bind(userId),
    env.DB.prepare("SELECT title_id, score FROM reviews WHERE user_id = ?").bind(userId),
    env.DB.prepare("SELECT g.name FROM user_genres ug JOIN genres g ON g.id = ug.genre_id WHERE ug.user_id = ?").bind(userId)
  ]);
  const weights = new Map();
  const seen = new Set();
  for (const row of library.results) {
    seen.add(row.title_id);
    let weight = SHELF_WEIGHT[row.status] ?? 0.5;
    if (row.favorite) weight += 2;
    if (row.chapter > 0 && weight > 0) weight += 0.3;
    weights.set(row.title_id, weight);
  }
  for (const row of reviews.results) {
    // 10 → +2, 6 → 0, 1 → -2.5: оценка уточняет отношение к тайтлу
    weights.set(row.title_id, (weights.get(row.title_id) || 0) + (row.score - 6) / 2);
    seen.add(row.title_id);
  }
  const genres = new Map();
  for (const row of favoriteGenres.results) genres.set(row.name, 3);
  return { weights, genres, tags: new Map(), seen, size: weights.size + favoriteGenres.results.length };
}

/** Профиль переводится в веса жанров и тегов по признакам тайтлов с полки */
function expandTaste(taste, features) {
  const genres = new Map(taste.genres);
  const tags = new Map();
  for (const [titleId, weight] of taste.weights || []) {
    const item = features.byId.get(titleId);
    if (!item) continue;
    for (const name of item.genres) genres.set(name, (genres.get(name) || 0) + weight);
    for (const [code, tag] of item.tags) tags.set(code, (tags.get(code) || 0) + weight * (tag.weight / 2));
  }
  // Нормировка: вкус не должен перевешивать выбранное настроение у тех, у кого большая полка
  const norm = (map) => {
    const max = Math.max(1, ...[...map.values()].map(Math.abs));
    return new Map([...map].map(([key, value]) => [key, (value / max) * 3]));
  };
  return { genres: norm(genres), tags: norm(tags) };
}

/**
 * Рекомендации. mood — ключ MOODS, titleId — для «похожего», excludeSeen — не показывать тайтлы с полки.
 * Возвращает { mood, items: [{ title, score, reasons }] }
 */
/**
 * @param {any} env
 * @param {{ userId?: number | null, mood: string, titleId?: number | null, limit?: number, excludeSeen?: boolean,
 *   type?: string | null, features?: any }} options
 */
export async function recommend(env, {
  userId = null, mood, titleId = null, limit = 12, excludeSeen = true, type = null, features: loaded = null
}) {
  const spec = MOODS[mood];
  if (!spec) throw new Error(`Неизвестное настроение ${mood}`);
  // features можно передать готовыми: главная считает несколько подборок по одному снимку каталога
  const [features, taste] = await Promise.all([loaded || loadFeatures(env), tasteProfile(env, userId)]);
  const preference = expandTaste(taste, features);
  const maxPopularity = Math.max(1, ...features.titles.map((title) => title.popularity || 0));

  const items = [];
  for (const title of features.titles) {
    if (type && title.type !== type) continue;
    if (titleId && title.id === titleId) continue;
    if (excludeSeen && taste.seen.has(title.id)) continue;
    const item = features.byId.get(title.id);
    let score = 0;
    const reasons = [];

    // Совпадение с настроением
    const moodTags = [];
    for (const [code, weight] of Object.entries(spec.tags)) {
      const tag = item.tags.get(code);
      if (tag) {
        score += weight * (tag.weight / 2);
        moodTags.push(tag.name);
      }
    }
    const moodGenres = [];
    for (const [name, weight] of Object.entries(spec.genres)) {
      if (item.genres.has(name)) {
        score += weight;
        moodGenres.push(name);
      }
    }
    if (moodTags.length || moodGenres.length) reasons.push({ kind: "mood", label: "Под настроение", items: [...moodTags, ...moodGenres] });
    if (spec.completedBonus && title.status === "completed" && score > 0) {
      score += spec.completedBonus;
      reasons.push({ kind: "status", label: "История завершена", items: [] });
    }

    // Похожее на выбранный тайтл
    if (mood === "similar") {
      if (!titleId) continue;
      const match = similarity(features, titleId, title.id);
      if (match.score <= 0) continue;
      score += match.score;
      reasons.push(...match.reasons);
    }

    // Малоизвестная жемчужина: высокая оценка при низкой популярности
    if (mood === "hidden_gem") {
      const quality = title.readerVotes >= 3 ? title.readerRating : title.rating;
      const obscurity = 1 - (title.popularity || 0) / maxPopularity;
      if (quality < 7.5 || obscurity < 0.5) continue;
      score += (quality - 7) * 2 + obscurity * 4;
      reasons.push({ kind: "gem", label: "Мало кто знает", items: [`оценка ${quality}`, `в библиотеках у ${title.readers}`] });
    }

    // Вкус пользователя: усиливает подходящее, но без настроения тайтл не попадает в выдачу
    if (score <= 0) continue;
    let tasteScore = 0;
    const tasteItems = [];
    for (const name of item.genres) {
      const weight = preference.genres.get(name);
      if (weight) {
        tasteScore += weight * 0.5;
        if (weight > 0) tasteItems.push(name);
      }
    }
    for (const [code, tag] of item.tags) {
      const weight = preference.tags.get(code);
      if (weight) {
        tasteScore += weight * 0.4 * (tag.weight / 2);
        if (weight > 1) tasteItems.push(tag.name);
      }
    }
    if (tasteScore > 0.5 && tasteItems.length) reasons.push({ kind: "taste", label: "Похоже на твои любимые", items: [...new Set(tasteItems)].slice(0, 4) });
    score += tasteScore;

    // Небольшая поправка на качество: при равном совпадении выше тайтл с лучшей оценкой
    const quality = title.readerVotes >= 3 ? title.readerRating : title.rating;
    score += (quality - 7) * 0.3;
    if (score <= 0) continue;
    items.push({ title, score: Math.round(score * 100) / 100, reasons });
  }

  items.sort((a, b) => b.score - a.score || b.title.rating - a.title.rating || a.title.id - b.title.id);
  return { mood, label: spec.label, personalized: taste.size > 0, items: items.slice(0, limit) };
}

/**
 * Персональная подборка для главной: без выбора настроения, только по вкусу пользователя.
 * Без истории — лучшие по оценке тайтлы
 */
export async function personalPicks(env, userId, limit = 8, loaded = null) {
  const [features, taste] = await Promise.all([loaded || loadFeatures(env), tasteProfile(env, userId)]);
  if (!taste.size) return { personalized: false, items: [] };
  const preference = expandTaste(taste, features);
  const items = [];
  for (const title of features.titles) {
    if (taste.seen.has(title.id)) continue;
    const item = features.byId.get(title.id);
    let score = 0;
    const matched = [];
    for (const name of item.genres) {
      const weight = preference.genres.get(name) || 0;
      score += weight * 0.6;
      if (weight > 0.8) matched.push(name);
    }
    for (const [code, tag] of item.tags) {
      const weight = preference.tags.get(code) || 0;
      score += weight * 0.5 * (tag.weight / 2);
      if (weight > 1) matched.push(tag.name);
    }
    if (score <= 0) continue;
    score += ((title.readerVotes >= 3 ? title.readerRating : title.rating) - 7) * 0.3;
    items.push({ title, score: Math.round(score * 100) / 100, reasons: matched.length ? [{ kind: "taste", label: "Похоже на твои любимые", items: [...new Set(matched)].slice(0, 4) }] : [] });
  }
  items.sort((a, b) => b.score - a.score || a.title.id - b.title.id);
  return { personalized: true, items: items.slice(0, limit) };
}
