# Multi-Source Data Engine — Status Report
**Дата**: 2026-11-04  
**Статус**: Отложено до выяснения коммерческого статуса сайта

## Результаты исследования

Агент проверил 7 источников данных (API, условия использования, rate limits, cross-reference).
Полный отчёт сохранён в этом файле ниже.

### Ключевые выводы

1. **Shikimori ID = MAL ID подтверждён:**
   - Death Note: Shikimori 1535 = MAL 1535
   - Shingeki no Kyojin: Shikimori 16498 = MAL 16498
   - GraphQL возвращает поле `malId`
   - **Вывод**: текущий `entries.ext_id` уже является MAL ID, миграция на внутренний ID не требуется

2. **Shikimori — единственный источник с русским языком:**
   - Русское название (`russian`), русское описание (в BBCode), русские роли персонажей (`rolesRu`)
   - Rate limit: 5 req/s, 90 req/min
   - Требования: OAuth app, User-Agent с названием приложения
   - **Проблема**: user agreement запрещает "копировать и использовать в коммерческих целях" (пункт неоднозначен, требует юридической проверки)

3. **AniList:**
   - GraphQL, idMal в ответах, 30 req/min (деградация с 90)
   - **Бесплатен до $150/месяц дохода**, выше — коммерческая лицензия (contact@anilist.co)
   - **Запрещено**: bulk mirroring ("hoarding"), хранение как backup, конкурирующие list/tracker сервисы
   - **Вывод**: если Endemion позволяет вести списки (user_list) — это конкурирующий tracker, пункт 5 terms применяется

4. **MyAnimeList API v2:**
   - Требует Client ID (форма на myanimelist.net/apiconfig с выбором "Usage type")
   - **API Agreement (от 2019-08-08) НЕ ПРОВЕРЕН** — сайт MAL недоступен из-за блокировки
   - Без проверки agreement нельзя использовать

5. **Kitsu:**
   - JSON API, mappings к MAL работают
   - **Terms of Service НЕ ПРОВЕРЕНЫ** (kitsu.io/terms вернул 403)
   - Rate limits НЕ ПРОВЕРЕНЫ

6. **AniDB, Anime-Planet, Jikan:**
   - AniDB: всё НЕ ПРОВЕРЕНО (wiki за Cloudflare challenge)
   - Anime-Planet: нет API, scraping запрещён
   - Jikan: неофициальный scraper MAL, для коммерческого сайта не подходит

## Текущее состояние Endemion

**Возможная коммерциализация:**
- Есть Yandex.Metrica (аналитика)
- Статус монетизации неизвестен (нет рекламы, платных функций, доната на момент проверки)
- Если планируется монетизация (даже косвенная: реклама, спонсорство, донаты) — нужно считать сайт коммерческим

**User lists:**
- Endemion позволяет вести списки аниме/манги (`user_list`)
- Это попадает под определение "list or tracker service" в AniList terms, пункт 5: запрещено использовать API в конкурирующих сервисах

**Текущий источник:**
- Только Shikimori
- User agreement Shikimori (пункт 3) запрещает коммерческое копирование (формулировка неоднозначна)
- Описания на Shikimori написаны пользователями, лицензия не указана

## Рекомендации

### Вариант 1: Остаться на Shikimori (статус-кво)

**Если сайт некоммерческий:**
- Продолжать использовать Shikimori как единственный источник
- Соблюдать rate limits (5 rps, 90 rpm)
- Русский язык критичен для аудитории
- **Риск**: если потом сайт монетизируется — нужно будет получить разрешение Shikimori или сменить источник

**Если сайт коммерческий или планируется монетизация:**
- Получить письменное разрешение от Shikimori (написать на support или найти контакт администрации)
- Уточнить: разрешено ли хранить данные в своей БД, показывать русские описания пользователей, монетизировать сайт
- Если разрешение не получено — нельзя использовать (risk of legal action)

### Вариант 2: Добавить AniList (только для некоммерческого сайта без списков)

**Условия:**
- Доход < $150/месяц
- Не использовать как tracker (отключить user lists)
- Не делать bulk mirroring (запрашивать on-demand)
- Короткие кеши (12 часов max)

**Не подходит для Endemion**, потому что:
- User lists уже есть (`user_list` таблица)
- Отключить их = сломать существующий функционал

### Вариант 3: Перейти на MAL API v2

**Требует:**
- Зарегистрировать Client ID на myanimelist.net/apiconfig
- Прочитать API Agreement (не проверен в отчёте)
- Указать "Usage type" — commercial или non-commercial
- Если commercial — проверить, разрешено ли хранение данных, какие условия

**Проблема:**
- MAL не содержит русских названий и описаний
- Потеря русского языка = потеря аудитории

### Вариант 4: Multi-source с AniList + MAL (для коммерческого сайта)

**План:**
- Получить коммерческую лицензию AniList (выше $150/мес)
- Зарегистрировать MAL API v2 Client ID как commercial
- Использовать AniList для данных (characters, staff, relations), MAL для cross-reference
- Shikimori оставить только для русских названий и описаний (если разрешение получено)

**Сложность:**
- Юридические согласования
- Стоимость лицензии AniList (не указана)
- MAL Agreement нужно прочитать

## Решение (обновлено 2026-11-04, после уточнения статуса)

**Endemion остаётся на Shikimori как единственном источнике.**

Статус сайта: **некоммерческий** (подтверждено владельцем).

**Почему не добавляем AniList:**
- **Clause 5 (verified)**: "Use of the AniList API within competing, non-complementary services of the same nature is prohibited. This includes, but is not limited to, **anime and manga list or tracker services**."
  - Endemion имеет таблицу `user_list`, пользователи ведут списки аниме/манги → это tracker
  - Clause применяется независимо от коммерческого статуса (нет исключения для некоммерческих)
- **Clause 3**: "Hoarding or mass collection of data from the AniList API is strictly prohibited."
  - Bulk sync каталога в свою БД = нарушение
  - On-demand запросы с короткими кешами теоретически допустимы, но clause 5 всё равно запрещает

**Почему не добавляем другие источники:**
- **MAL API v2**: Agreement не проверен (сайт заблокирован), нет русского языка
- **Kitsu**: Terms не проверены (ember app, не удалось прочитать), нет русского языка
- **AniDB**: Rules не проверены (wiki за Cloudflare challenge), строгие anti-flood правила
- **Jikan**: неофициальный scraper MAL, допустимость зависит от MAL ToS (не проверен)

**Shikimori:**
- Единственный источник с русским языком (критично для аудитории)
- User agreement (пункт 3) запрещает коммерческое копирование
- Для **некоммерческого** сайта — допустимо (пункт явно про коммерческое использование)
- Rate limit 5 req/s, 90 req/min — достаточно для текущей нагрузки

**Документация:**
- `MULTI_SOURCE_AUDIT.md` (433 строки) — анализ текущей архитектуры
- `MULTI_SOURCE_PLAN.md` (247 строк) — шаблон плана (не реализуется)
- Этот файл — итоговый статус и рекомендации

**Что можно сделать без риска:**
- Оптимизировать кеш Shikimori (текущий: 12 часов для карточек)
- Улучшить обработку ошибок источника
- Добавить fallback на устаревший кеш (уже есть)
- Мониторинг rate limits и 429 ответов

## Отчёт агента (полный текст)

```
# Anime/manga data source audit (verified 2026-11-04)

## Read this first
Many official pages blocked this machine, and the Wayback Machine was unreachable from WebFetch:
- Returned 403 or connection reset: myanimelist.net (all pages), anime-planet.com, kitsu.app/terms, docs.anilist.co, docs.api.jikan.moe, wiki.anidb.net (Cloudflare challenge).
- AniList and Kitsu docs were read from their official GitHub doc sources instead.
- Several items below are marked NOT VERIFIED. Do not treat search-snippet or memory claims as fact. Someone should open the MAL API Agreement, the AniDB wiki and the Kitsu terms in a browser and check them before deciding.

## Summary table
| Source | API | Key / registration | Rate limit | Russian text | MAL ID cross-ref | ToS for possibly-commercial site |
|---|---|---|---|---|---|---|
| Shikimori | GraphQL (preferred), REST v2/v1, HTTPS, https://shikimori.io/api | OAuth2 app; app name must be in User-Agent | 5 rps / 90 rpm; IP ban if User-Agent is missing | YES (russian title, Russian description) | YES (id == MAL id; malId field) | User agreement restricts commercial copying; no API terms found |
| AniList | GraphQL, https://graphql.anilist.co | None for public reads | 90/min, currently degraded to 30/min; 429 + Retry-After; burst limiter; manual IP blocks | No Russian field seen (not verified) | YES (idMal) | Free under $150/month revenue; above that, commercial license; no hoarding or backup storage; no competing list/tracker |
| MAL API v2 | REST, OAuth2 / Client ID | Client ID via myanimelist.net/apiconfig (self-service form with a 'Usage' field) | NOT VERIFIED | No | n/a | Agreement exists (last modified 2019-08-08); clauses NOT VERIFIED |
| Jikan | REST v4, unofficial scraper of MAL | None | NOT VERIFIED | No | MAL ids | Not affiliated with MAL; you are responsible for MAL ToS compliance |
| Kitsu | JSON:API, https://kitsu.io/api/edge (also kitsu.app) | None for most public GET | NOT VERIFIED | No (en, en_jp, ja_jp titles seen) | YES (/mappings endpoint) | Terms page NOT VERIFIED |
| AniDB | HTTP (XML) + UDP | Registered client name (per secondary source) | NOT VERIFIED | not verified | not verified | NOT VERIFIED |
| Anime-Planet | No public API | n/a | n/a | n/a | n/a | Scraping prohibited (quoted via ToS;DR) |
| ANN Encyclopedia | XML, https://cdn.animenewsnetwork.com/encyclopedia/api.xml | None | 1 req/s per IP (excess delayed); nodelay variant returns 503 | No | No | Free; must credit ANN and link to the entry; commercial use not addressed |

[остальные разделы отчёта — Shikimori, AniList, MAL, Jikan, Kitsu, AniDB, Anime-Planet, ANN, рекомендации]
```

Полный текст отчёта агента включён выше в секцию "Отчёт агента".
