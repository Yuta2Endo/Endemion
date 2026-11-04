# Multi-Source Data Engine — Implementation Plan
**Дата**: 2026-11-04  
**Статус**: Draft (ожидание результатов исследования источников)

## Контекст

Endemion сейчас зависит исключительно от Shikimori. Необходимо создать независимую энциклопедию
с данными из нескольких проверенных источников.

Аудит текущей архитектуры: `MULTI_SOURCE_AUDIT.md` (424 строки, закоммичен).

## Выбранные источники для первой интеграции

> **Заполнится после получения отчёта агента.**
>
> Критерии выбора:
> - Публичный API (не scraping)
> - Условия использования не запрещают хранение данных и commercial use (или явно разрешают некоммерческое)
> - Rate limits позволяют запросить 50+ произведений в час
> - Cross-reference с MAL ID или другим общим идентификатором
> - Доступность персонажей, создателей, связей

Предварительный список кандидатов (до проверки условий):
1. AniList (GraphQL)
2. Kitsu (JSON API)
3. MyAnimeList API v2 (официальный, требует client ID)
4. Jikan (неофициальный MAL REST API — допустимость зависит от MAL terms)

## Этапы реализации

### Stage 0: Decision (после отчёта агента)

**Вход**: отчёт агента о 7 источниках (API, terms, rate limits, данные, cross-reference).

**Решения**:
1. Выбрать 2-3 источника для интеграции (на основе terms, API, cross-ref)
2. Решить, менять ли `entries(kind, ext_id)` на внутренний `id`:
   - Если Shikimori ID = MAL ID (проверить на 10 примерах) — можно оставить `ext_id` как внутренний ID Endemion
   - Иначе — миграция на `entries.id`, `external_ids`, обновление всех FK
3. Выбрать стратегию matching: cross-reference (MAL ID) или fuzzy match по названию + год

**Выход**: список источников, стратегия ID, план миграции БД.

### Stage 1: Schema Migration

**Если решено менять ключ**:
- Миграция `0020_multi_source_ids.sql`:
  - Добавить `entries.id INTEGER`
  - Создать `external_ids(entry_id, source, external_id, kind, url, verified)`
  - Создать `field_sources(entry_id, field, source, source_id, fetched_at, confidence)`
  - Добавить FK-столбцы в `user_list`, `entry_reviews`, `universe_*`
  - Заполнить `external_ids` из `(kind, ext_id)` с `source='shikimori'`
  - Пересоздать `entries` с `id` как PK
  - Удалить старые `kind`, `ext_id`

**Если оставляем ext_id**:
- Миграция `0020_external_ids.sql`:
  - Создать `external_ids(entry_id, source, external_id, kind, url, verified)` где `entry_id` = текущий `ext_id`
  - Заполнить из entries: `INSERT INTO external_ids (entry_id, source, external_id, kind) SELECT ext_id, 'shikimori', ext_id, kind FROM entries`
  - Создать `field_sources`

**Тесты**: после миграции все существующие тесты (99) должны проходить. API `GET /api/universe/anime/1535` продолжает работать.

### Stage 2: Provider Interface Extension

Расширить интерфейс провайдера (опционально):
```javascript
export const features = {
  hasCharacters: boolean,
  hasStaff: boolean,
  hasVoiceActors: boolean,
  hasRelations: boolean,
  providesExternalIds: string[],  // ["mal", "anilist"]
  searchByExternalId: { mal: boolean, ... }
};

export async function findByExternalId(http, source, externalId, kind)  // опционально
```

Обновить `functions/_lib/catalog/index.js`:
- `PROVIDERS` теперь Map: `{ shikimori, anilist, kitsu }`
- Создать `RateGate` для каждого провайдера (не одна общая)
- Добавить функцию `enrichFromSources(entry, sources)` — объединение данных из нескольких источников

### Stage 3: AniList Provider (пример)

> Подставится реальный выбранный источник после отчёта агента.

Создать `functions/_lib/catalog/anilist.js`:
- `export const name = "anilist"`
- `export const BASE = "https://graphql.anilist.co"`
- Реализовать `listEntries`, `getEntry`, `getCharacter`, etc.
- Привести ответы к модели `model.js`
- Вернуть `externalIds: { mal: ..., anidb: ... }` из `getEntry`

Тесты:
- `tests/anilist.test.mjs`: запросы через подмену `CATALOG_FETCH`, проверка приведения к модели
- Не ходить в живой API из тестов (rate limits)

### Stage 4: Matching Mechanism

Создать `functions/_lib/catalog/matching.js`:
```javascript
export async function findEntryByExternalId(env, source, externalId, kind)
export async function matchEntry(env, candidateEntry, confidence)
export async function suggestMatch(env, entry1, entry2)  // для админки
```

Алгоритм:
1. Проверить `external_ids`: есть ли запись с этим `(source, external_id)`?
2. Если нет — проверить cross-reference: источник даёт idMal, есть ли entry с таким MAL ID?
3. Если нет — fuzzy match по названию + год (confidence 0.6-0.7)
4. Если confidence < 0.8 — добавить в `match_candidates` для ручной проверки

Таблица `match_candidates`:
```sql
CREATE TABLE match_candidates (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER REFERENCES entries(id),  -- существующая запись или NULL
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  candidate_data TEXT NOT NULL,  -- JSON: название, год, постер
  confidence REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  created_at, reviewed_at
);
```

### Stage 5: Enrichment

Добавить в `functions/_lib/catalog/index.js`:
```javascript
export async function getEntryEnriched(env, kind, id) {
  // 1. Найти entry по внутреннему ID (или ext_id если ключ не менялся)
  // 2. Загрузить external_ids и field_sources
  // 3. Для каждого поля проверить приоритет источников (из catalog_settings)
  // 4. Если поле отсутствует или устарело — запросить у следующего источника
  // 5. Объединить данные, сохранить происхождение в field_sources
  // 6. Вернуть обогащённую запись
}
```

Приоритеты в `catalog_settings`:
```json
{
  "source_priorities": {
    "title": ["manual", "shikimori", "anilist"],
    "description": ["anilist", "shikimori"],
    "poster": ["shikimori", "anilist"],
    "characters": ["anilist", "shikimori"],
    "staff": ["anilist", "shikimori"]
  }
}
```

Кеш обогащённых записей:
```sql
CREATE TABLE enriched_cache (
  entry_id INTEGER PRIMARY KEY REFERENCES entries(id),
  data TEXT NOT NULL,  -- JSON
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
```

TTL 6 часов. При ручном редактировании очищать.

### Stage 6: Admin Panel

Добавить раздел «Источники данных» в `/admin#sources`:
- Список активных источников, включить/отключить
- Приоритеты для полей (редактор JSON)
- Запуск импорта вручную: выбрать источник, импортировать произведение по ID
- Просмотр `match_candidates`: карточки двух записей рядом, кнопки «Объединить» / «Отклонить»
- Просмотр `external_ids` для записи
- Просмотр `field_sources`: откуда получено каждое поле

Действия администратора:
- Объединить записи: обновить `external_ids`, перенести ссылки `user_list` и т.д., пометить одну запись как `merged_into`
- Разъединить ошибочно объединённые (audit log, обратное действие)
- Ручное редактирование поля: `field_sources.source = 'manual'` (наивысший приоритет)

### Stage 7: Import & Sync

Создать `functions/_lib/catalog/import.js`:
```javascript
export async function importEntry(env, source, externalId, kind)
export async function syncEntry(env, entryId)  // обновить из всех источников
```

Периодическая синхронизация (cron или queue):
- Обновлять снимки старше 7 дней
- Проверять новые эпизоды (для ongoing аниме)
- Обновлять рейтинги

**Не делать**: массовый импорт всех каталогов. Импорт только:
- По запросу пользователя (поиск, добавление в список)
- Вручную администратором
- Постепенно в фоне (10-20 записей в час)

### Stage 8: Testing & Validation

1. **Unit tests**: каждый провайдер с подменой fetch
2. **Integration tests**: matching, enrichment, import (на тестовой базе)
3. **Manual testing**:
   - Импортировать 10 произведений из нового источника
   - Проверить matching (правильно ли сопоставились с Shikimori)
   - Проверить enrichment (заполнились ли пустые поля)
   - Проверить админку (показываются ли источники, можно ли объединить)
4. **Regression tests**: все 99 существующих тестов проходят

### Stage 9: Deployment

1. Резервная копия продакшн базы
2. Накатить миграцию `0020_*.sql`
3. Обновить код (provider, matching, enrichment, admin)
4. Проверить на live-сайте: `/anime/1535-death-note` работает, Universe Explorer работает
5. Администратор импортирует первые 10-20 записей из нового источника
6. Мониторинг ошибок `catalog_errors`, rate limits

## Риски и митигации

**Риск**: условия использования запрещают commercial use.
**Митигация**: проверить до интеграции (отчёт агента), не интегрировать источники с запретом.

**Риск**: превышение rate limits → бан IP.
**Митигация**: соблюдать лимиты (RateGate), постепенный импорт, мониторинг 429.

**Риск**: ошибочное объединение записей → испорченные пользовательские данные.
**Митигация**: низкая confidence требует ручной проверки, audit log, возможность разъединить.

**Риск**: источник меняет API или terms.
**Митигация**: мониторинг ошибок, возможность отключить источник без поломки сайта (fallback на другие).

**Риск**: конфликты данных (разные источники дают разное число эпизодов).
**Митигация**: приоритет источников, ручное редактирование администратором, показывать происхождение данных.

## Статус

Ожидание отчёта агента о доступных источниках (API, terms, cross-ref).

После отчёта:
1. Выбрать источники
2. Решить про миграцию ключа
3. Заполнить план конкретными источниками
4. Начать реализацию со Stage 1
