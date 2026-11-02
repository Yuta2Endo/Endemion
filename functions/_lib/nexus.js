// ENDEMION NEXUS: связи между тайтлами по общим жанрам, тегам (атмосфера, герой, сюжет, темы, мир), авторам,
// связям из админки и читателям, у которых оба тайтла на полке. Каждая связь объясняется: какие именно признаки общие.
// Всё считается по базе, без внешних сервисов. Каталог небольшой (тысячи тайтлов), поэтому признаки грузятся целиком

import { TAG_CATEGORIES } from "./taxonomy.js";
import { listTitles } from "./titles.js";
import { RELATION_KINDS } from "./titleExtras.js";

// Вес признаков в сходстве. Тег с весом 3 («главное в тайтле») значит больше, чем тег с весом 1
export const WEIGHTS = {
  genre: 1,
  tag: { mood: 1.4, hero: 1.6, plot: 1.5, theme: 1.2, setting: 1 },
  author: 3,
  relation: 4,
  readers: 0.6,
  sameType: 0.3
};

// Сколько общих читателей учитывать: больше — уже не добавляет сходства
const READERS_CAP = 5;

/** Все признаки каталога: тайтлы, их жанры, теги, авторы, связи из админки и общие читатели */
export async function loadFeatures(env) {
  const [titles, batch] = await Promise.all([
    listTitles(env, "popular"),
    env.DB.batch([
      env.DB.prepare("SELECT tg.title_id, g.name FROM title_genres tg JOIN genres g ON g.id = tg.genre_id"),
      env.DB.prepare("SELECT tt.title_id, tt.weight, t.code, t.category, t.name FROM title_tags tt JOIN tags t ON t.id = tt.tag_id"),
      env.DB.prepare("SELECT ta.title_id, a.name FROM title_authors ta JOIN authors a ON a.id = ta.author_id"),
      env.DB.prepare("SELECT title_id, related_id, kind FROM title_relations"),
      // Пары тайтлов, которые вместе лежат на полках читателей (кроме брошенных)
      env.DB.prepare(
        `SELECT a.title_id AS a, b.title_id AS b, COUNT(*) AS n FROM library a JOIN library b
           ON a.user_id = b.user_id AND a.title_id < b.title_id
         WHERE (a.status IS NULL OR a.status <> 'dropped') AND (b.status IS NULL OR b.status <> 'dropped')
         GROUP BY a.title_id, b.title_id`
      )
    ])
  ]);
  const [genres, tags, authors, relations, pairs] = batch.map((result) => result.results);

  const byId = new Map(titles.map((title) => [title.id, { title, genres: new Set(), tags: new Map(), authors: new Set() }]));
  for (const row of genres) byId.get(row.title_id)?.genres.add(row.name);
  for (const row of tags) byId.get(row.title_id)?.tags.set(row.code, { category: row.category, name: row.name, weight: row.weight });
  for (const row of authors) byId.get(row.title_id)?.authors.add(row.name);

  const relationMap = new Map();
  for (const row of relations) {
    relationMap.set(`${row.title_id}:${row.related_id}`, row.kind);
    const back = row.kind === "sequel" ? "prequel" : row.kind === "prequel" ? "sequel" : row.kind;
    if (!relationMap.has(`${row.related_id}:${row.title_id}`)) relationMap.set(`${row.related_id}:${row.title_id}`, back);
  }
  const readersMap = new Map();
  for (const row of pairs) {
    readersMap.set(`${row.a}:${row.b}`, row.n);
    readersMap.set(`${row.b}:${row.a}`, row.n);
  }
  return { titles, byId, relations: relationMap, readers: readersMap };
}

/**
 * Сходство двух тайтлов и объяснение. reasons — по категориям: что общего (жанры, атмосфера, герой...).
 * score 0 — ничего общего
 */
export function similarity(features, aId, bId) {
  const a = features.byId.get(aId);
  const b = features.byId.get(bId);
  if (!a || !b || aId === bId) return { score: 0, reasons: [] };
  let score = 0;
  const reasons = [];

  const relation = features.relations.get(`${aId}:${bId}`);
  if (relation) {
    score += WEIGHTS.relation;
    reasons.push({ kind: "relation", label: RELATION_KINDS[relation], items: [] });
  }

  const authors = [...a.authors].filter((name) => b.authors.has(name));
  if (authors.length) {
    score += WEIGHTS.author * authors.length;
    reasons.push({ kind: "author", label: "Тот же автор", items: authors });
  }

  const genres = [...a.genres].filter((name) => b.genres.has(name));
  if (genres.length) {
    // Общий жанр значит больше, если жанров у тайтлов мало
    score += WEIGHTS.genre * genres.length * (2 / Math.sqrt(Math.max(a.genres.size, 1) * Math.max(b.genres.size, 1)) + 0.5);
    reasons.push({ kind: "genre", label: "Жанры", items: genres });
  }

  const byCategory = {};
  for (const [code, tag] of a.tags) {
    const other = b.tags.get(code);
    if (!other) continue;
    // Совпадение двух главных тегов (вес 3 и 3) важнее, чем двух упомянутых вскользь (1 и 1)
    score += WEIGHTS.tag[tag.category] * Math.sqrt(tag.weight * other.weight) / 1.5;
    (byCategory[tag.category] ||= []).push(tag.name);
  }
  for (const category of Object.keys(TAG_CATEGORIES)) {
    if (byCategory[category]) reasons.push({ kind: category, label: TAG_CATEGORIES[category], items: byCategory[category] });
  }

  const readers = features.readers.get(`${aId}:${bId}`) || 0;
  if (readers) {
    score += WEIGHTS.readers * Math.min(readers, READERS_CAP);
    reasons.push({ kind: "readers", label: "Читают вместе", items: [`${readers} ${readersWord(readers)}`] });
  }

  // Тип (манга, манхва, маньхуа) сам по себе связью не считается, только усиливает уже найденную
  if (score > 0 && a.title.type === b.title.type) score += WEIGHTS.sameType;

  return { score: Math.round(score * 100) / 100, reasons };
}

function readersWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "читатель";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "читателя";
  return "читателей";
}

/** Самые похожие тайтлы с объяснением. focus — категория, по которой ищем (genre, mood, hero, plot, theme, setting) */
export function relatedTitles(features, titleId, { limit = 8, focus = null } = {}) {
  const results = [];
  for (const other of features.titles) {
    if (other.id === titleId) continue;
    const { score, reasons } = similarity(features, titleId, other.id);
    if (score <= 0) continue;
    if (focus && !reasons.some((reason) => reason.kind === focus)) continue;
    // При фокусе на категории сильнее поднимаются тайтлы, у которых в ней больше совпадений
    const focusBoost = focus ? (reasons.find((reason) => reason.kind === focus)?.items.length || 0) * 2 : 0;
    results.push({ title: other, score: score + focusBoost, reasons });
  }
  results.sort((x, y) => y.score - x.score || y.title.popularity - x.title.popularity || x.title.id - y.title.id);
  return results.slice(0, limit);
}

/**
 * Граф для визуализации: центральный тайтл, его соседи и соседи соседей (depth 2).
 * Рёбра между всеми узлами графа, если сходство выше порога. Каждое ребро — с главной причиной связи
 */
export function buildGraph(features, centerId, { neighbours = 8, depth = 2, focus = null } = {}) {
  const nodes = new Map();
  const center = features.byId.get(centerId);
  if (!center) return null;
  nodes.set(centerId, 0);

  const first = relatedTitles(features, centerId, { limit: neighbours, focus });
  for (const item of first) nodes.set(item.title.id, 1);
  if (depth > 1) {
    for (const item of first.slice(0, 4)) {
      for (const next of relatedTitles(features, item.title.id, { limit: 3, focus })) {
        if (!nodes.has(next.title.id) && nodes.size < neighbours + 10) nodes.set(next.title.id, 2);
      }
    }
  }

  const ids = [...nodes.keys()];
  const edges = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const { score, reasons } = similarity(features, ids[i], ids[j]);
      const involvesCenter = ids[i] === centerId || ids[j] === centerId;
      // Рёбра с центром — всегда, между соседями — только заметные, иначе граф превращается в клубок
      if (score <= 0 || (!involvesCenter && score < 3)) continue;
      edges.push({ source: ids[i], target: ids[j], score, primary: primaryReason(reasons), reasons });
    }
  }

  return {
    center: centerId,
    nodes: ids.map((id) => ({ ...compactTitle(features.byId.get(id).title), level: nodes.get(id) })),
    edges
  };
}

/** Главная причина связи для подписи ребра */
function primaryReason(reasons) {
  const order = ["relation", "author", "hero", "plot", "mood", "theme", "genre", "setting", "readers"];
  return [...reasons].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0]?.kind || null;
}

/** Только то, что нужно карточке в графе */
export function compactTitle(title) {
  return {
    id: title.id,
    title: title.title,
    type: title.type,
    status: title.status,
    year: title.year,
    author: title.author,
    rating: title.rating,
    readerRating: title.readerRating,
    readerVotes: title.readerVotes,
    genres: title.genres,
    symbol: title.symbol,
    poster: title.poster,
    cover: title.cover,
    chapters: title.chapters
  };
}
