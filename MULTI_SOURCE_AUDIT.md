# Multi-Source Data Engine — Audit
**Дата**: 2026-11-04  
**Цель**: расширить Endemion до независимой энциклопедии с данными из нескольких источников вместо зависимости только от Shikimori

## 1. Текущая архитектура каталога

### 1.1. Слой каталога (functions/_lib/catalog/)

**Файлы** (3034 строки):
- `index.js` (485 строк): единая точка доступа, выбор провайдера, кеш, очередь запросов, лимиты, повторы, журнал ошибок
- `shikimori.js` (424 строки): провайдер Shikimori (GraphQL для списков, REST для персонажей/людей)
- `model.js` (116 строк): типы, статусы, адреса страниц — не зависит от источника
- `bbcode.js` (50 строк): парсинг BBCode-описаний Shikimori в HTML
- `lists.js` (248 строк): построение фильтрованных списков для каталога
- `render.js` (112 строк): серверный рендер карточек произведений

**Принципы**:
- Страницы и API берут данные только из слоя каталога, к внешнему источнику напрямую не ходят
- Провайдер выбирается в `PROVIDERS = { shikimori }`, переменная `CATALOG_PROVIDER` (по умолчанию `"shikimori"`)
- Комментарий в коде: «Сменить источник — добавить провайдер с теми же функциями, что у shikimori.js, и выбрать его в CATALOG_PROVIDER»

### 1.2. Интерфейс провайдера

Shikimori провайдер экспортирует:
```javascript
export const name = "shikimori";
export const label = "Shikimori";
export const BASE = "https://shikimori.io";
export const rateLimit = { requests: 4, per: 1000, burst: 80, perMinute: 60000 };

// Функции провайдера, вызываемые слоем каталога:
export async function listEntries(http, kind, filters, page, limit)
export async function getEntry(http, kind, id)
export async function getGenres(http, kind)
export async function searchAll(http, text)
export async function listCharacters(http, { search, page, limit })
export async function popularCharacters(http, kind)
export async function getCharacter(http, id)
export async function listPeople(http, { search, role, page, limit })
export async function getPerson(http, id)
export async function listStudios(http)
export async function getStudio(http, id)
```

**Параметр `http`**: функция `http(operation, url, init)`, которую передаёт слой каталога. Провайдер не делает `fetch` напрямую. `http` обрабатывает:
- Кеширование в `catalog_cache` (TTL 15 мин для списков, 24 часа для карточек, 7 дней для жанров/студий)
- Rate limiting (4 req/s, 80 req/min для Shikimori)
- Повторы при 429, 5xx (до 2 раз, экспоненциальная задержка)
- Возврат устаревшей копии из кеша при недоступности источника
- Объединение одинаковых одновременных запросов (inflight dedupe)
- Журнал ошибок в `catalog_errors` (последние 500)

**Модель данных**: провайдер приводит свои ответы к модели `model.js`. Пример карточки произведения:
```javascript
{
  kind: "anime" | "manga",
  id: number,
  slug: string,
  title: string,           // русское или оригинальное
  titleEn: string,
  type: string,            // "tv", "movie", "manga" etc.
  status: string,          // "ongoing", "released"
  year: number | null,
  units: number,           // эпизоды или главы
  unitsAired: number,
  volumes: number,
  score: number | null,
  genres: [{ id, name }],
  poster: { small, small2x, medium, medium2x, large }
}
```

Полная карточка (`getEntry`) дополнительно:
```javascript
{
  titleOriginal, titleJapanese, synonyms: string[],
  rating, duration, season, description, airedOn, releasedOn,
  characters: [{ id, slug, name, nameEn, image, role: "main" | "supporting" }],
  staff: [{ id, slug, name, image, roles: string[] }],
  studios: [{ id, slug, name, image }],
  related: [{ relation, relationKind, entry }],
  externalLinks: [{ kind, url }]
}
```

### 1.3. Снимки произведений (entries)

**Таблица `entries`**: короткие снимки произведений, с которыми взаимодействовали пользователи (добавили в список, избранное, написали отзыв). Хранятся поля: `kind`, `ext_id` (номер в источнике), `slug`, `title`, `title_en`, `poster` (JSON), `type`, `status`, `year`, `units`, `units_aired`, `duration`, `score`, `genres` (JSON), `refreshed_at`.

**Зачем**: список пользователя показывается по снимкам без запросов к источнику. Снимок обновляется при запросе полной карточки, если старше суток.

**PK**: `(kind, ext_id)` — без повторов. `ext_id` — это ID в источнике (Shikimori). Например, Death Note = 1535, Shingeki no Kyojin = 16498.

**Связи**: `user_list`, `favorites`, `entry_reviews`, `universe_entities`, `universe_relations` ссылаются на `(kind, ext_id)` через внешний ключ.

### 1.4. Ограничения текущей системы

1. **Единственный источник**: Shikimori. Если он недоступен или не содержит произведение — данных нет.
2. **ID привязан к источнику**: `ext_id` — это ID Shikimori. Смена источника сломает все связи.
3. **Нет механизма объединения**: если добавить второй источник, произведения с разными ID будут дублироваться.
4. **Нет enrichment**: если Shikimori не содержит персонажей или описания — их не получить из другого источника.
5. **Нет происхождения данных**: неясно, откуда получена информация.
6. **Нет cross-reference**: нет таблицы сопоставления ID между источниками.

### 1.5. Что работает хорошо

1. **Провайдеры подменяемы**: интерфейс определён, новый провайдер = новый файл + выбор в `PROVIDERS`.
2. **Кеширование вынесено**: провайдер не знает о кеше, слой каталога сам кеширует ответы.
3. **Rate limiting вынесен**: провайдер не делает `fetch`, слой каталога сам соблюдает лимиты.
4. **Устаревшая копия при сбое**: если источник недоступен, показывается устаревший кеш — сайт работает.
5. **Снимки для UX**: пользовательские данные (списки, избранное) не зависят от доступности источника.

## 2. Требуемые изменения для Multi-Source

### 2.1. Внутренний ID произведения

**Проблема**: `ext_id` — это ID в источнике. Смена источника или добавление второго сломает связи.

**Решение**: ввести внутренний `id` в Endemion, независимый от источников. `entries` станет:
```sql
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,  -- внутренний ID Endemion
  kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  ...
  created_at, updated_at, merged_into INTEGER -- для дубликатов
);
```

### 2.2. Таблица external_ids

Сопоставление внутреннего ID с ID в источниках:
```sql
CREATE TABLE external_ids (
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  source TEXT NOT NULL,       -- "shikimori", "anilist", "mal", "kitsu"
  external_id TEXT NOT NULL,  -- ID в источнике
  kind TEXT NOT NULL,         -- "anime" | "manga"
  url TEXT,                   -- прямой адрес в источнике
  verified INTEGER NOT NULL DEFAULT 0,  -- 0 = auto, 1 = admin confirmed
  PRIMARY KEY (source, kind, external_id),
  UNIQUE (entry_id, source)
);
```

Пример: Death Note = внутренний ID 1001, внешние ID:
- `(1001, "shikimori", "1535", "anime", "https://shikimori.io/animes/1535", 1)`
- `(1001, "anilist", "1535", "anime", "https://anilist.co/anime/1535", 1)`
- `(1001, "mal", "1535", "anime", "https://myanimelist.net/anime/1535", 1)`
- `(1001, "kitsu", "1376", "anime", "https://kitsu.io/anime/1376", 0)`

### 2.3. Таблица field_sources

Происхождение каждого поля:
```sql
CREATE TABLE field_sources (
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  field TEXT NOT NULL,           -- "title", "description", "poster", "characters"
  source TEXT NOT NULL,          -- "shikimori", "anilist", "manual"
  source_id TEXT,                -- external_id в источнике
  fetched_at INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,  -- 0.0-1.0 для auto-match
  PRIMARY KEY (entry_id, field)
);
```

### 2.4. Приоритеты источников

Настройки в `catalog_settings`:
```sql
-- Добавить JSON с приоритетами:
-- { "title": ["manual", "shikimori", "anilist"], "description": ["anilist", "shikimori"], ... }
source_priorities TEXT NOT NULL DEFAULT '{}'
```

### 2.5. Обновлённый интерфейс провайдера

Провайдер должен уметь:
1. Искать по external_id другого источника (для cross-reference)
2. Возвращать external_ids, которые знает источник (например, AniList возвращает `idMal`)
3. Указывать, какие поля он предоставляет (не все источники дают всё)

Расширенный интерфейс:
```javascript
export const features = {
  hasCharacters: true,
  hasStaff: true,
  hasVoiceActors: false,  // seyu
  hasRelations: true,
  hasRecommendations: true,
  hasDescriptionRu: true,
  providesExternalIds: ["mal"],  // AniList даёт idMal
  searchByExternalId: { mal: true, anidb: false }
};

// Новая функция: поиск по ID из другого источника
export async function findByExternalId(http, source, externalId, kind)

// getEntry теперь возвращает external_ids:
{
  ...,
  externalIds: { mal: 1535, anidb: 5030 }
}
```

### 2.6. Механизм объединения (matching)

При импорте произведения из нового источника:
1. Проверить `external_ids`: уже есть такой source + external_id?
2. Если нет — проверить cross-reference: источник даёт idMal, есть ли entry с таким MAL ID?
3. Если нет — попытка по названию + год (fuzzy match, низкая confidence)
4. Если confidence < 0.8 — добавить в таблицу `match_candidates` для ручной проверки администратором

### 2.7. Enrichment

При запросе `getEntry(kind, id)`:
1. Найти `entry` по внутреннему ID
2. Загрузить снимок из `entries`
3. Загрузить `external_ids` и `field_sources`
4. Для каждого поля проверить приоритет источников
5. Если поле отсутствует или устарело — запросить у следующего по приоритету источника
6. Объединить данные, сохранить происхождение в `field_sources`

### 2.8. Миграция существующих данных

**Проблема**: `entries(kind, ext_id)` — составной PK, на него ссылаются:
- `user_list(kind, ext_id)` — списки пользователей
- `favorites(target_type, ext_id)` где `target_type IN ('anime', 'manga')` — избранное
- `entry_reviews(kind, ext_id)` — отзывы пользователей
- `universe_entities(kind, ext_id)` — организации, локации, события для Universe Explorer
- `universe_relations(kind, ext_id)` — связи вселенной

**Комментарии** (`comments.target_type`, `comments.target_id`): тоже используют внешние ID для целей `'anime'` и `'manga'`, но без FK (проверка только CHECK constraint).

**План миграции**:
1. Добавить `entries.id INTEGER` (внутренний ID), заполнить `id = rowid`
2. Создать `external_ids`, заполнить из `(kind, ext_id)` с `source='shikimori'`
3. Добавить FK-столбцы во все зависимые таблицы: `user_list.entry_id`, `favorites.entry_id` и т.д.
4. Заполнить их из `entries.id` по `(kind, ext_id)`
5. Удалить старые столбцы `kind`, `ext_id` (после проверки, что новые FK заполнены)
6. Пересоздать `entries` с `id` как PK вместо `(kind, ext_id)`
7. Обновить индексы и FK

**Внимание**: `comments` не имеют FK на `entries`, только `target_type` и `target_id`. После миграции `target_id` для `'anime'`/`'manga'` должен ссылаться на внутренний `entries.id`, но CHECK constraint не изменится. Нужно:
- Добавить FK `FOREIGN KEY (target_id) REFERENCES entries(id)` для `target_type IN ('anime', 'manga')`
- Или оставить без FK, но при создании комментария проверять существование `entries.id`

**Обратная совместимость**: после миграции API `GET /api/universe/anime/1535` должен продолжать работать. `1535` — это external_id в Shikimori, нужно искать `entry_id` через `external_ids` и возвращать данные по внутреннему ID.

## 3. Источники данных (предварительный список)

**Агент проверяет сейчас**:
- Shikimori: текущий источник, GraphQL + REST, 4 req/s, 80 req/min
- AniList: GraphQL, rate limit?, idMal в ответах?
- MyAnimeList: официальный API v2 + Jikan (неофициальный REST)
- Kitsu: JSON API, rate limit?
- AniDB: HTTP + UDP API, клиентская регистрация, строгие правила
- Anime-Planet: API есть? или scraping-only?
- Anime News Network: Encyclopedia API (XML)

**Ожидаемый результат от агента**: таблица с API URL, rate limits, требованиями к ключам, условиями использования (commercial, attribution, caching, scraping prohibitions), доступными данными (characters, staff, relations, images, Russian descriptions), cross-reference (idMal, idAnilist).

### 3.1. Минимальные требования к провайдеру

Для интеграции источника обязательны:
1. **Публичный API** (не scraping)
2. **Доступ к anime и manga** (хотя бы один вид)
3. **Базовые поля**: название (оригинальное + английское), тип, статус, год, изображение
4. **Условия использования** не запрещают: хранение данных, commercial use (или явно разрешают некоммерческое)
5. **Rate limits** позволяют запрашивать 50-100 произведений в час

Желательны:
- Персонажи с ролями (main/supporting)
- Создатели (staff) с ролями (director, producer, etc.)
- Связи между произведениями (sequel, prequel, adaptation)
- Описание на английском или русском (>200 символов)
- Cross-reference: idMal, idAnilist, idAnidb
- Изображения: poster, banner, character images

Не критичны, но полезны:
- Сэйю (voice actors)
- Жанры (можно взять из другого источника)
- Рекомендации
- Рейтинг/оценки пользователей
- Альтернативные названия
- Внешние ссылки (official site, social media)

### 3.2. Приоритеты для первой интеграции

**Высокий приоритет**:
1. **AniList**: GraphQL, активно поддерживается, много данных, cross-reference на MAL
2. **Kitsu**: JSON API, открытые данные
3. **Jikan (MAL)**: неофициальный REST API для MyAnimeList, но широко используется

**Средний приоритет**:
4. **MyAnimeList API v2**: официальный, но требует client ID, модерация заявки
5. **AniDB**: много данных, но строгие правила (бан за превышение лимитов), требует регистрации клиента

**Низкий приоритет**:
6. **Anime-Planet**: если есть API (проверяет агент); если нет API — не интегрировать
7. **ANN**: XML API, узкая специализация (новости + справочник), не первостепенно

### 3.3. Cross-reference между источниками

**MyAnimeList ID** — de facto стандарт: Shikimori использует MAL ID как свой `ext_id` для большинства произведений.

Проверка (примеры):
- Death Note: MAL 1535 = Shikimori 1535 = AniList idMal 1535
- Shingeki no Kyojin: MAL 16498 = Shikimori 16498 = AniList idMal 16498

**AniList**: в GraphQL-ответе есть `idMal` для большинства записей → автоматическое сопоставление.

**Kitsu**: есть mappings API (`/api/edge/mappings`) для связи с MAL, AniList, AniDB.

**AniDB**: свои ID (aid), но есть сторонние таблицы сопоставления AniDB ↔ MAL.

**Стратегия**:
1. MAL ID как основной cross-reference
2. AniList сопоставляется через `idMal`
3. Kitsu через mappings API
4. Shikimori уже использует MAL ID → миграция проста
5. Для произведений без MAL ID (редко) — сопоставление по AniList ID или ручное

## 4. Следующие шаги

**После получения отчёта агента**:
1. Выбрать 2-3 источника для первой интеграции (приоритет: AniList, Kitsu, возможно Jikan)
2. Написать `MULTI_SOURCE_PLAN.md` с этапами реализации
3. Реализовать:
   - Миграцию схемы (entries.id, external_ids, field_sources)
   - Базовый механизм matching по cross-reference
   - Провайдер AniList
   - Enrichment для одного поля (например, description)
   - Админку: просмотр происхождения данных, ручное объединение
4. Тестирование на 10-20 произведениях
5. Постепенное наполнение

**Не делать**:
- Массовый импорт всех каталогов без проверки лимитов
- Scraping без API
- Автоматическое объединение с низкой confidence без ручной проверки
- Замену существующих данных без сохранения истории

## 5. Риски и ограничения

1. **Licenses**: некоторые источники могут запрещать commercial use или хранение данных
2. **API keys**: MAL, AniDB требуют регистрации клиента, возможна модерация
3. **Rate limits**: превышение может привести к бану IP
4. **Images**: изображения могут быть под другой лицензией, чем данные. Текущая система хранит только URL (не скачивает), `img referrerpolicy="no-referrer"` в HTML. Для multi-source нужно:
   - Хранить URL из каждого источника отдельно: `poster_sources: { shikimori: {...}, anilist: {...} }`
   - Выбирать URL по приоритету или показывать srcset из нескольких источников
   - Не смешивать изображения разных источников без проверки лицензий
5. **Maintenance**: каждый источник = свой адаптер, нужно отслеживать изменения API
6. **Conflicts**: разные источники могут содержать противоречивые данные (название, год, число эпизодов). Решение:
   - Приоритет источников для каждого поля (настраивается)
   - Ручное редактирование администратором (`field_sources.source = 'manual'` имеет наивысший приоритет)
   - В админке показывать все варианты из разных источников перед объединением
7. **Matching errors**: ошибочное объединение произведений = испорченные данные пользователей. Решение:
   - Низкая confidence (< 0.8) требует ручной проверки
   - Возможность разъединить ошибочно объединённые записи (admin action, audit log)
   - Match по cross-reference (idMal, idAnilist) имеет confidence 0.95+
   - Match только по названию + год = confidence 0.6-0.7
8. **Cache invalidation**: текущая система кеширует ответы с TTL 30 мин (списки) — 7 дней (жанры). При multi-source:
   - Кеш на уровне провайдера (как сейчас)
   - Объединённый результат тоже кешируется (`enriched_cache` с TTL 6 часов)
   - При ручном редактировании очищать enriched_cache для этой записи

## 6. Текущая система кеша и ошибок

**catalog_cache**: ключ = `"operation:url"`, значение = JSON, TTL зависит от операции:
- Списки: 30 мин
- Поиск: 1 час
- Карточка произведения: 12 часов
- Персонаж, человек: 24 часа
- Жанры, студии: 7 дней
- Отсутствующая запись (404): 1 час

**Устаревшие записи** (`expires_at` в прошлом) остаются в базе до 7 дней: если источник недоступен, показывается устаревшая копия. Очистка раз в сутки удаляет записи старше 7 дней.

**catalog_errors**: последние 500 ошибок с `provider`, `operation`, `status`, `message`, `created_at`. Показываются в админке `/admin#catalog`, есть кнопка «Очистить журнал».

**При multi-source**:
- `catalog_cache` продолжает кешировать ответы каждого провайдера
- Новая таблица `enriched_cache` кеширует объединённый результат из нескольких источников
- `catalog_errors` добавляет `source` (не только `provider`)
- Если один источник недоступен, enrichment пытается другой

## 7. Изображения и hotlinking

**Текущая система**:
- URL изображений хранятся в базе (`entries.poster` JSON, `catalog_cache`)
- HTML: `<img src="https://shikimori.io/..." referrerpolicy="no-referrer">`
- CSP: `img-src 'self' data: https://shikimori.io https://mc.yandex.ru`
- Не скачивает и не проксирует изображения

**Shikimori poster**:
```javascript
{
  small: "https://shikimori.io/.../preview.webp",      // 160px width
  small2x: "https://shikimori.io/.../preview2x.webp",  // 320px
  medium: "https://shikimori.io/.../main.webp",        // 225px
  medium2x: "https://shikimori.io/.../main2x.webp"     // 450px
}
```

**При multi-source**:
1. Каждый источник возвращает свои URL изображений
2. `entries.poster` становится `poster_sources JSON`:
   ```json
   {
     "shikimori": { "small": "...", "small2x": "...", "medium": "...", "medium2x": "..." },
     "anilist": { "large": "https://s4.anilist.co/.../large.jpg" },
     "mal": { "medium": "https://cdn.myanimelist.net/.../...jpg" }
   }
   ```
3. Приоритет источников для изображений: `["shikimori", "anilist", "mal"]` (настраивается)
4. CSP обновляется: добавить домены всех источников
5. HTML может показывать srcset из нескольких источников (fallback)
6. **Не скачивать изображения**: оставить hotlink, проверить в terms каждого источника

## Статус

Ожидание отчёта агента о доступных API и условиях использования.
