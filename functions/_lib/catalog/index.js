// Единый слой каталога энциклопедии. Страницы и API берут данные только отсюда, к внешнему источнику напрямую не ходят.
// Здесь: выбор провайдера, кеш ответов в базе (с выдачей устаревшей копии, если источник недоступен),
// одна очередь запросов под лимиты источника, повторы при сбоях, объединение одинаковых одновременных запросов,
// журнал ошибок интеграции и настройки каталога из админки.
// Сменить источник — добавить провайдер с теми же функциями, что у shikimori.js, и выбрать его в CATALOG_PROVIDER

import * as shikimori from "./shikimori.js";
import { KINDS, slugify } from "./model.js";

const PROVIDERS = { shikimori };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Сколько живёт ответ в кеше. После срока запись остаётся ещё STALE_KEEP: её покажут, если источник не отвечает
const TTL = {
  list: 30 * MINUTE, home: 20 * MINUTE, search: HOUR, entry: DAY, character: DAY, person: DAY, people: 6 * HOUR,
  characters: 6 * HOUR, popular: 6 * HOUR, genres: 7 * DAY, studios: 7 * DAY, missing: HOUR
};
const STALE_KEEP = 7 * DAY;
const TIMEOUT_MS = 10_000;
const RETRIES = 2;
const ERRORS_KEEP = 500;
const DEFAULT_USER_AGENT = "Endemion (+https://endemion.online)";

/** Источник не ответил, а копии в кеше нет. status — код ответа нашего API */
export class CatalogError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = "CatalogError";
    this.status = status;
  }
}

class UpstreamError extends Error {
  constructor(operation, status, message) {
    super(message);
    this.name = "UpstreamError";
    this.operation = operation;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ==================== ОЧЕРЕДЬ ЗАПРОСОВ ====================

/**
 * Не больше perSecond запросов в секунду и perMinute в минуту на весь сервер. Запросы ждут своей очереди;
 * если ждать пришлось бы дольше maxWaitMs, запрос сразу получает отказ (и страница берёт копию из кеша)
 */
export class RateGate {
  constructor({ perSecond, perMinute, maxWaitMs }) {
    this.rules = [[perSecond, 1000], [perMinute, MINUTE]];
    this.maxWaitMs = maxWaitMs;
    this.times = [];
    this.pending = 0;
    this.pausedUntil = 0;
    this.chain = Promise.resolve();
    this.requestsLastMinute = 0;
    this.lastMinuteReset = Date.now();
  }

  /** После ответа 429 источник просит подождать: вся очередь ждёт */
  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  take() {
    const enqueued = Date.now();
    if (this.pending * (1000 / this.rules[0][0]) > this.maxWaitMs) {
      return Promise.reject(new UpstreamError("queue", null, "Очередь запросов к источнику переполнена"));
    }
    this.pending++;
    const turn = this.chain.then(() => this.wait(enqueued)).finally(() => this.pending--);
    this.chain = turn.catch(() => {});
    return turn;
  }

  async wait(enqueued) {
    for (;;) {
      const now = Date.now();
      this.times = this.times.filter((time) => time > now - MINUTE);
      // Обновить счётчик запросов за последнюю минуту
      if (now - this.lastMinuteReset >= MINUTE) {
        this.requestsLastMinute = 0;
        this.lastMinuteReset = now;
      }
      let delay = Math.max(0, this.pausedUntil - now);
      for (const [count, windowMs] of this.rules) {
        const recent = this.times.filter((time) => time > now - windowMs);
        if (recent.length >= count) delay = Math.max(delay, recent[recent.length - count] + windowMs - now);
      }
      if (delay <= 0) {
        this.times.push(now);
        this.requestsLastMinute++;
        return;
      }
      if (now + delay - enqueued > this.maxWaitMs) throw new UpstreamError("queue", null, "Источник занят: очередь запросов слишком длинная");
      await sleep(delay);
    }
  }
}

// Лимит Shikimori — 5 запросов в секунду и 90 в минуту. Берём с запасом: сайт не должен упираться в лимит
const gate = new RateGate({ perSecond: 4, perMinute: 80, maxWaitMs: 8000 });

// ==================== ЗАПРОСЫ К ИСТОЧНИКУ ====================

function provider(env) {
  const chosen = PROVIDERS[env.CATALOG_PROVIDER || "shikimori"];
  if (!chosen) throw new Error(`Неизвестный источник каталога: ${env.CATALOG_PROVIDER}`);
  return chosen;
}

/**
 * HTTP-клиент для провайдера: очередь, тайм-аут, повторы при сбое сети, 429 и 5xx.
 * Возвращает JSON или null при 404. env.CATALOG_FETCH подменяет fetch в тестах (тогда без очереди)
 */
function httpClient(env) {
  const fetchImpl = env.CATALOG_FETCH || fetch;
  const userAgent = env.CATALOG_USER_AGENT || DEFAULT_USER_AGENT;
  const retryBase = Number(env.CATALOG_RETRY_BASE_MS) || 400;
  return async function http(operation, url, init) {
    for (let attempt = 0; ; attempt++) {
      if (!env.CATALOG_FETCH) await gate.take();
      let response = null;
      let problem;
      try {
        response = await fetchImpl(url, {
          ...init,
          headers: { Accept: "application/json", "User-Agent": userAgent, ...init.headers },
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
      } catch (err) {
        problem = err?.name === "TimeoutError" ? `Нет ответа за ${TIMEOUT_MS / 1000} с` : `Сеть: ${err?.message || err}`;
      }
      if (response) {
        if (response.status === 404) return null;
        if (response.ok) {
          try {
            return await response.json();
          } catch {
            problem = "Ответ не в формате JSON";
          }
        } else {
          problem = `HTTP ${response.status}`;
        }
      }
      const status = response?.status ?? null;
      const retryable = !response || status === 429 || status >= 500;
      if (!retryable || attempt >= RETRIES) throw new UpstreamError(operation, status, problem);
      const retryAfter = Number(response?.headers.get("Retry-After")) * 1000;
      const delay = Math.min(5000, retryAfter > 0 ? retryAfter : retryBase * 3 ** attempt);
      if (status === 429 && !env.CATALOG_FETCH) gate.pause(delay);
      await sleep(delay);
    }
  };
}

// ==================== ЖУРНАЛ ОШИБОК ====================

async function logError(env, err) {
  const upstream = err instanceof UpstreamError;
  console.error(`Каталог: ${upstream ? err.operation : "ошибка"} — ${err.message}`);
  try {
    await env.DB.prepare("INSERT INTO catalog_errors (provider, operation, status, message) VALUES (?, ?, ?, ?)")
      .bind(provider(env).name, upstream ? err.operation : "internal", upstream ? err.status : null, String(err.message).slice(0, 500)).run();
    if (Math.random() < 0.05) {
      await env.DB.prepare("DELETE FROM catalog_errors WHERE id <= (SELECT MAX(id) FROM catalog_errors) - ?").bind(ERRORS_KEEP).run();
    }
    // Проверка порога ошибок: если за последний час больше 50 — уведомить администраторов
    if (Math.random() < 0.02) {
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM catalog_errors WHERE created_at > datetime('now', '-1 hour')").first();
      if (count.n >= 50) {
        const admins = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin'").all();
        const text = `Каталог: более ${count.n} ошибок за последний час. Проверьте состояние источника в /admin#catalog`;
        for (const admin of admins.results) {
          await env.DB.prepare("INSERT INTO notifications (user_id, type, text, link) VALUES (?, 'system', ?, '/admin')")
            .bind(admin.id, text).run().catch(() => {});
        }
      }
    }
  } catch (logErr) {
    console.error("Ошибка каталога не записана в журнал:", logErr.message);
  }
}

// ==================== КЕШ ====================

// Одинаковые одновременные запросы ждут один ответ источника. Своя карта у каждой базы: тесты поднимают несколько приложений
const inflightByDb = new WeakMap();

function inflight(env) {
  let map = inflightByDb.get(env.DB);
  if (!map) inflightByDb.set(env.DB, (map = new Map()));
  return map;
}

/**
 * Значение из кеша или из источника. Если источник не ответил, отдаётся просроченная копия;
 * если копии нет — CatalogError. Ответ «не найдено» (null) кешируется на час
 */
async function cached(env, key, ttl, load) {
  const fullKey = `${provider(env).name}:${key}`;
  const now = Date.now();
  const row = await env.DB.prepare("SELECT value, expires_at FROM catalog_cache WHERE key = ?").bind(fullKey).first();
  if (row && row.expires_at > now) return JSON.parse(row.value);

  const tasks = inflight(env);
  if (tasks.has(fullKey)) return tasks.get(fullKey);
  const task = (async () => {
    try {
      const value = await load(httpClient(env));
      const life = value === null ? TTL.missing : ttl;
      await env.DB.prepare(
        `INSERT INTO catalog_cache (key, value, fetched_at, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`
      ).bind(fullKey, JSON.stringify(value), now, now + life).run();
      if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM catalog_cache WHERE expires_at < ?").bind(now - STALE_KEEP).run();
      return value;
    } catch (err) {
      await logError(env, err);
      if (row) return JSON.parse(row.value);
      throw new CatalogError("Каталог сейчас недоступен: источник данных не отвечает. Попробуйте через минуту.");
    }
  })().finally(() => tasks.delete(fullKey));
  tasks.set(fullKey, task);
  return task;
}

// ==================== НАСТРОЙКИ ====================

// Жанры, скрытые по умолчанию: хентай, эротика, яой и юри (номера жанров Shikimori)
export const DEFAULT_SETTINGS = {
  allowAdult: false,
  hiddenGenres: { anime: [12, 539, 33, 34], manga: [602, 601, 65, 75] },
  hero: null
};

const settingsMemo = new WeakMap();
const SETTINGS_MEMO_MS = 30 * 1000;

export async function getSettings(env) {
  const memo = settingsMemo.get(env.DB);
  if (memo && memo.until > Date.now()) return memo.value;
  const { results } = await env.DB.prepare("SELECT key, value FROM catalog_settings").all();
  const stored = Object.fromEntries(results.map((row) => [row.key, JSON.parse(row.value)]));
  const value = {
    allowAdult: stored.allowAdult ?? DEFAULT_SETTINGS.allowAdult,
    hiddenGenres: { ...DEFAULT_SETTINGS.hiddenGenres, ...(stored.hiddenGenres || {}) },
    hero: stored.hero ?? DEFAULT_SETTINGS.hero
  };
  settingsMemo.set(env.DB, { value, until: Date.now() + SETTINGS_MEMO_MS });
  return value;
}

/** Сохранить настройки. Значения уже проверены обработчиком админки */
export async function saveSettings(env, settings) {
  await env.DB.batch(Object.entries(settings).map(([key, value]) => env.DB.prepare(
    `INSERT INTO catalog_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, JSON.stringify(value))));
  settingsMemo.delete(env.DB);
  // В кеше подборки с прежними настройками
  await env.DB.prepare("DELETE FROM catalog_cache WHERE key LIKE ? OR key LIKE ?").bind("%:home:%", "%:list:%").run();
}

/** Скрыто ли произведение настройками: взрослый рейтинг или скрытый жанр */
export function isHidden(entry, settings) {
  if (settings.allowAdult) return false;
  if (entry.ageRating === "rx") return true;
  const hidden = new Set(settings.hiddenGenres[entry.kind] || []);
  return (entry.genres || []).some((genre) => hidden.has(genre.id));
}

const censored = (settings) => !settings.allowAdult;
const hiddenFor = (settings, kind) => (settings.allowAdult ? [] : settings.hiddenGenres[kind] || []);

// ==================== ПРОИЗВЕДЕНИЯ ====================

/** Страница каталога. filters проверены обработчиком (functions/api/catalog.js) */
export async function listEntries(env, kind, filters) {
  const settings = await getSettings(env);
  const query = {
    ...filters,
    censored: censored(settings),
    excludeGenres: [...new Set([...(filters.excludeGenres || []), ...hiddenFor(settings, kind)])]
  };
  const key = `list:${kind}:${JSON.stringify(query, Object.keys(query).sort())}`;
  return cached(env, key, TTL.list, (http) => provider(env).listEntries(http, kind, query));
}

/** Произведение целиком или null */
export async function getEntry(env, kind, id) {
  if (!KINDS.includes(kind)) return null;
  return cached(env, `entry:${kind}:${id}`, TTL.entry, (http) => provider(env).getEntry(http, kind, id));
}

/** Жанры вида без скрытых настройками */
export async function getGenres(env, kind) {
  const [settings, list] = await Promise.all([getSettings(env), allGenres(env, kind)]);
  const hidden = new Set(hiddenFor(settings, kind));
  return list.filter((genre) => !hidden.has(genre.id));
}

export async function allGenres(env, kind) {
  return cached(env, `genres:${kind}`, TTL.genres, (http) => provider(env).genres(http, kind));
}

export async function homeData(env) {
  const settings = await getSettings(env);
  const year = new Date().getUTCFullYear();
  const excludeGenres = { anime: hiddenFor(settings, "anime"), manga: hiddenFor(settings, "manga") };
  const data = await cached(env, `home:${year}:${censored(settings)}:${JSON.stringify(excludeGenres)}`, TTL.home,
    (http) => provider(env).home(http, { censored: censored(settings), year, excludeGenres }));
  let hero = data.hero.filter((entry) => entry.poster);
  // Произведение, выбранное в админке, — первым
  if (settings.hero) {
    try {
      const chosen = await getEntry(env, settings.hero.kind, settings.hero.id);
      if (chosen) hero = [chosen, ...hero.filter((entry) => entry.id !== chosen.id || entry.kind !== chosen.kind)];
    } catch {}
  }
  return { ...data, hero: hero.slice(0, 5) };
}

export async function searchAll(env, text) {
  const settings = await getSettings(env);
  const query = text.trim().toLowerCase();
  const result = await cached(env, `search:${censored(settings)}:${query}`, TTL.search,
    (http) => provider(env).search(http, { query, limit: 8, censored: censored(settings) }));
  const studios = (await listStudios(env)).filter((studio) => studio.name.toLowerCase().includes(query)).slice(0, 8);
  return { ...result, studios };
}

// ==================== ПЕРСОНАЖИ, ЛЮДИ, СТУДИИ ====================

export async function listCharacters(env, { search, page, limit }) {
  return cached(env, `characters:${search.toLowerCase()}:${page}:${limit}`, TTL.characters,
    (http) => provider(env).listCharacters(http, { search, page, limit }));
}

export async function popularCharacters(env, kind) {
  return cached(env, `popular:characters:${kind}`, TTL.popular, (http) => provider(env).popularCharacters(http, kind));
}

export async function getCharacter(env, id) {
  return cached(env, `character:${id}`, TTL.character, (http) => provider(env).getCharacter(http, id));
}

export async function listPeople(env, { search, role, page, limit }) {
  return cached(env, `people:${search.toLowerCase()}:${role}:${page}:${limit}`, TTL.people,
    (http) => provider(env).listPeople(http, { search, role, page, limit }));
}

export async function getPerson(env, id) {
  return cached(env, `person:${id}`, TTL.person, (http) => provider(env).getPerson(http, id));
}

// Список студий большой (около 2000) и меняется редко: держится ещё и в памяти процесса
const studiosMemo = new WeakMap();

export async function listStudios(env) {
  const memo = studiosMemo.get(env.DB);
  if (memo && memo.until > Date.now()) return memo.value;
  const value = await cached(env, "studios", TTL.studios, (http) => provider(env).listStudios(http));
  studiosMemo.set(env.DB, { value, until: Date.now() + HOUR });
  return value;
}

export async function getStudio(env, id) {
  return (await listStudios(env)).find((studio) => studio.id === id) || null;
}

// ==================== СНИМКИ ДЛЯ СПИСКОВ ====================

/** Запрос, который сохраняет короткий снимок произведения: по нему списки показываются без обращений к источнику */
export function snapshotStatement(env, entry) {
  return env.DB.prepare(
    `INSERT INTO entries (kind, ext_id, slug, title, title_en, poster, type, status, year, units, units_aired, duration, score, genres, refreshed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (kind, ext_id) DO UPDATE SET slug = excluded.slug, title = excluded.title, title_en = excluded.title_en,
       poster = excluded.poster, type = excluded.type, status = excluded.status, year = excluded.year, units = excluded.units,
       units_aired = excluded.units_aired, duration = excluded.duration, score = excluded.score, genres = excluded.genres,
       refreshed_at = excluded.refreshed_at`
  ).bind(
    entry.kind, entry.id, entry.slug || slugify(entry.titleEn), entry.title, entry.titleEn || "", JSON.stringify(entry.poster || {}),
    entry.type || "", entry.status || "", entry.year ?? null, entry.units || 0, entry.unitsAired || 0, entry.duration || 0,
    entry.score ?? null, JSON.stringify((entry.genres || []).slice(0, 8).map(({ id, name }) => ({ id, name }))), Date.now()
  );
}

/** Снимок из базы в виде карточки каталога */
export function snapshotToEntry(row) {
  return {
    kind: row.kind,
    id: row.ext_id,
    slug: row.slug,
    title: row.title,
    titleEn: row.title_en,
    poster: JSON.parse(row.poster || "{}"),
    type: row.type,
    status: row.status,
    year: row.year,
    units: row.units,
    unitsAired: row.units_aired,
    duration: row.duration,
    score: row.score,
    genres: JSON.parse(row.genres || "[]")
  };
}

/** Снимок произведения, свежий не старше суток. null — произведения нет в источнике */
export async function ensureSnapshot(env, kind, id) {
  const row = await env.DB.prepare("SELECT * FROM entries WHERE kind = ? AND ext_id = ?").bind(kind, id).first();
  if (row && row.refreshed_at > Date.now() - DAY) return snapshotToEntry(row);
  let entry;
  try {
    entry = await getEntry(env, kind, id);
  } catch (err) {
    // Источник недоступен: старый снимок лучше, чем отказ сохранить список
    if (row) return snapshotToEntry(row);
    throw err;
  }
  if (!entry) return null;
  await snapshotStatement(env, entry).run();
  return entry;
}

// ==================== РЕКОМЕНДАЦИИ ====================

/**
 * Рекомендации по списку пользователя: любимые жанры считаются по оценкам (оценка выше 6 — плюс, ниже 5 — минус)
 * и по просмотренному. Затем из источника берутся лучшие по рейтингу произведения с этими жанрами, которых в списке ещё нет
 */
export async function recommendations(env, userId, kind) {
  const { results } = await env.DB.prepare(
    `SELECT l.ext_id, l.score, l.status, e.genres FROM user_list l JOIN entries e ON e.kind = l.kind AND e.ext_id = l.ext_id
     WHERE l.user_id = ? AND l.kind = ?`
  ).bind(userId, kind).all();
  if (!results.length) return { items: [], genres: [], basedOn: 0 };
  const weights = new Map();
  for (const row of results) {
    const weight = row.score ? row.score - 5.5 : row.status === "completed" ? 1 : row.status === "dropped" ? -1.5 : 0.5;
    for (const genre of JSON.parse(row.genres || "[]")) {
      const current = weights.get(genre.id) || { ...genre, weight: 0 };
      current.weight += weight;
      weights.set(genre.id, current);
    }
  }
  const top = [...weights.values()].filter((genre) => genre.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 2);
  if (!top.length) return { items: [], genres: [], basedOn: results.length };
  const seen = new Set(results.map((row) => row.ext_id));
  const page = await listEntries(env, kind, { page: 1, limit: 40, order: "ranked", genres: top.map((genre) => genre.id) });
  return {
    items: page.items.filter((entry) => !seen.has(entry.id)).slice(0, 12),
    genres: top.map(({ id, name }) => ({ id, name })),
    basedOn: results.length
  };
}

// ==================== АДМИНКА ====================

/** Состояние источника: ответ на проверочный запрос, кеш и последние ошибки */
export async function providerStatus(env) {
  const current = provider(env);
  const started = Date.now();
  let ping = { ok: true, ms: 0, error: null };
  try {
    await current.ping(httpClient(env));
    ping.ms = Date.now() - started;
  } catch (err) {
    ping = { ok: false, ms: Date.now() - started, error: err.message };
    await logError(env, err);
  }
  const now = Date.now();
  const [cache, errors, errorsDay] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS total, SUM(expires_at > ?) AS fresh, SUM(length(value)) AS bytes FROM catalog_cache").bind(now),
    env.DB.prepare("SELECT id, provider, operation, status, message, created_at FROM catalog_errors ORDER BY id DESC LIMIT 50"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM catalog_errors WHERE created_at > datetime('now', '-1 day')")
  ]);
  const stats = cache.results[0];
  return {
    provider: { name: current.name, label: current.label, base: current.BASE },
    ping,
    queue: { pending: gate.pending, requestsLastMinute: gate.requestsLastMinute },
    cache: { total: stats.total || 0, fresh: stats.fresh || 0, bytes: stats.bytes || 0 },
    errorsDay: errorsDay.results[0].n,
    errors: errors.results.map((row) => ({
      id: row.id, provider: row.provider, operation: row.operation, status: row.status, message: row.message, createdAt: row.created_at
    }))
  };
}

export async function clearCache(env) {
  const result = await env.DB.prepare("DELETE FROM catalog_cache").run();
  studiosMemo.delete(env.DB);
  return result.meta.changes;
}

export async function clearErrors(env) {
  await env.DB.prepare("DELETE FROM catalog_errors").run();
}
