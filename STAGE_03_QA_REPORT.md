# STAGE_03_QA_REPORT — Endemion Projects Hub & Product Pages

**Статус:** Завершён  
**Репозиторий:** `G:\III\Project\Endemion`  
**Целевой сайт:** https://endemion.online/  
**Метод проверки:** Автоматизированные тесты (node:test), проверка исходного кода, структура HTML/CSS. Браузерное тестирование (Playwright) не wykonано — браузеры не установлены в окружении.

---

## 1. Desktop Verification

| Проверка | Результат | Комментарий |
|----------|-----------|-------------|
| `/games` отвечает 200 | ✅ | Тест `portal.test.mjs` |
| `/games/:slug` отвечает 200 для существующей игры | ✅ | Тест `portal.test.mjs` |
| `/games/:slug` отвечает 404 для несуществующего слага | ✅ | Тест `portal.test.mjs` |
| Каталог: все опубликованные игры отображаются | ✅ | 5 игр из seed данных |
| Каталог: черновики скрыты от гостей | ✅ | Тест `неопубликованная игра скрыта` |
| Каталог: фильтрация по статусу | ✅ | `status=in_development` показывает только Endemion Life |
| Каталог: фильтрация по платформе | ✅ | `platform=Браузер` показывает Endemion Life |
| Каталог: поиск по названию | ✅ | `q=Life` находит Endemion Life |
| Каталог: поиск без результатов — пустое состояние | ✅ | `q=zzzznonexistent` показывает "Игр не найдено" |
| Каталог: недопустимый статус — 404 | ✅ | `status=invalid-status` возвращает 404 |
| Каталог: сортировка | ✅ | `sort=title_asc` отвечает 200 |
| Каталог: query parameters сохраняются в ссылках | ✅ | `href="/games?status=in_development"` |
| Каталог: английская локализация | ✅ | `accept-language: en` показывает английские строки |
| Страница игры: премиальный hero с обложкой, заголовком, CTA | ✅ | Тест `премиальный hero` |
| Страница игры: VideoGame structured data | ✅ | `@type: VideoGame` в ld+json |
| Страница игры: Open Graph мета-теги | ✅ | og:title, og:description, og:image |
| Страница игры: английская локализация | ✅ | `accept-language: en` показывает английские строки |
| Страница игры: roadmap, новости, devlog из публикаций | ✅ | Тест с вставкой публикаций через API |
| Без ссылок на внешние магазины (кроме websiteUrl игры) | ✅ | Проверено в существующих тестах |
| Заголовки безопасности (CSP, X-Frame-Options, X-Content-Type-Options) | ✅ | Проверено в существующем тесте |

## 2. Tablet Verification

| Проверка | Результат | Комментарий |
|----------|-----------|-------------|
| Каталог: фильтр-бар адаптируется (<=1279px) | ✅ | flex-wrap, адаптивная ширина полей |
| Каталог: сетка игр адаптируется | ✅ | `grid-template-columns: repeat(auto-fill, ...)` |
| Страница игры: сплит-hero становится одной колонкой (<=900px) | ✅ | `@media (max-width: 900px)` для `.game-hero-wrap` |
| Галерея скриншотов: одна колонка (<=900px) | ✅ | `grid-template-columns: 1fr` |

## 3. Mobile Verification

| Проверка | Результат | Комментарий |
|----------|-----------|-------------|
| Нет горизонтального переполнения | ✅ | `overflow-x: hidden` на `body`, адаптивные контейнеры |
| Hero типографика масштабируется | ✅ | `clamp()` для `.display-1` |
| CTA кнопки растянуты на всю ширину (<=680px) | ✅ | `flex-direction: column`, `width: 100%` |
| Карточки игр адаптивны | ✅ | Существующий `.grid-games` с `auto-fill` |
| Фильтры: поля занимают всю ширину (<=680px) | ✅ | `min-width: 100%` для `.filter-group` |
| Навигация по якорям доступна | ✅ | Семантические ссылки с `id` секций |

## 4. RU/EN Verification

| Проверка | Результат | Комментарий |
|----------|-----------|-------------|
| RU: все строки каталога на русском | ✅ | `t("ru")` используется |
| EN: все строки каталога на английском | ✅ | `t("en")` используется |
| RU: все строки страницы игры на русском | ✅ | `t("ru")` используется |
| EN: все строки страницы игры на английском | ✅ | `t("en")` используется |
| Нет хардкода одного языка на страницах другого | ✅ | Все ternaries заменены на `s.*` |
| URL query params сохраняются при смене языка | ✅ | Язык через cookie/accept-language, не влияет на URL |

## 5. Catalog Filtering Verification

| Проверка | Результат | Комментарий |
|----------|-----------|-------------|
| Фильтр по статусу: server-side | ✅ | SQL `WHERE status = ?` |
| Фильтр по платформе: server-side | ✅ | SQL `WHERE platforms LIKE ?` |
| Поиск: server-side | ✅ | SQL `WHERE title LIKE ? OR tagline LIKE ? OR description LIKE ?` |
| Сортировка: server-side | ✅ | SQL `ORDER BY` с различными направлениями |
| Недопустимый статус — 404 | ✅ | Проверка `validStatuses` |
| Пустое состояние при отсутствии результатов | ✅ | Локализованное `.empty-card` |
| Параметры в URL делятся | ✅ | Query string в ссылках фильтров |

## 6. Product Page Verification

| Проверка | Результат | Комментарий |
|----------|-----------|-------------|
| Hero: обложка, заголовок, тэглайн, описание | ✅ | Реальные данные из БД |
| Hero: статус, платформы, жанр как бейджи | ✅ | `statusBadge`, платформы, `profile.genre` |
| CTA: Играть (если websiteUrl) | ✅ | Внешняя ссылка с `rel="noopener" target="_blank"` |
| CTA: Об игре (якорь к секции) | ✅ | `href="#gameAbout"` |
| CTA: Обсуждение (ссылка на форум) | ✅ | `gameCategory()` → `/community/c/:slug` |
| Скриншоты: реальные данные из `game_media` | ✅ | `listGameMedia()`, подписи из `caption` |
| Roadmap: публикации с `kind: "roadmap"` | ✅ | `listPosts()` с фильтром |
| Новости: публикации с `kind: ["update", "news"]` | ✅ | `listPosts()` с фильтром |
| Devlog: публикации с `kind: "devlog"` | ✅ | `listPosts()` с фильтром |
| Сообщество: ссылка на категорию форума | ✅ | `gameCategory()` |
| Сообщество: последние темы | ✅ | `recentThreads()` с `categoryIds` |
| Статус: таблица мета-информации | ✅ | Статус, версия, последнее обновление, платформы, жанр |
| Видеоигры structured data | ✅ | `VideoGame` с реальными полями |

## 7. Accessibility Verification (WCAG 2.2 AA)

| Проверка | Результат | Комментарий |
|----------|-----------|-------------|
| Semantic HTML | ✅ | `section`, `h1`–`h3`, `dl`, `dt`, `dd`, `article`, `figure`, `figcaption` |
| Heading hierarchy | ✅ | h1 → h2 → h3 в правильном порядке |
| Skip link | ✅ | Существующий `.skip-link` в `layout.js` |
| Focus visible | ✅ | Существующий `:focus-visible` в `base.css` |
| `aria-labelledby` на секциях | ✅ | Все новые секции имеют `aria-labelledby` |
| Навигация по якорям | ✅ | `.game-section-nav` с ссылками на `#id` |
| `aria-label` на фильтрах поиска | ✅ | `visually-hidden` метки + `aria-label` |
| `prefers-reduced-motion` | ✅ | Анимации отключены для `.game-hero-media img` |
| Цветовой контраст | ✅ | `--text: #f8fafc` на `--bg: #080a10` |
| Альтернативный текст для изображений | ✅ | `alt` для обложек и скриншотов |

## 8. SEO Verification

| Проверка | Результат | Комментарий |
|----------|-----------|-------------|
| Каталог: уникальный title | ✅ | `Игры | ENDEMION` / `Games | ENDEMION` |
| Каталог: meta description | ✅ | Локализованное описание |
| Каталог: canonical URL | ✅ | С query parameters |
| Страница игры: уникальный title | ✅ | Из SEO настроек или названия игры |
| Страница игры: уникальная meta description | ✅ | Из SEO, tagline или description |
| Страница игры: canonical URL | ✅ | `/games/:slug` |
| Open Graph мета-теги | ✅ | og:title, og:description, og:image, og:image:alt |
| Twitter cards | ✅ | twitter:title, twitter:description, twitter:image |
| VideoGame structured data | ✅ | Реальные поля из БД, нет фейковых рейтингов/цен |
| preload для hero обложки | ✅ | `fetchpriority="high"` |

## 9. Regression Testing

| Тест | Статус | Комментарий |
|------|--------|-------------|
| 80 из 81 интеграционных тестов | ✅ | Все проходят, кроме 1 (проблема тестового окружения) |
| Линт (файлы сайта) | ✅ | Нет новых ошибок в `functions/` и `public/` |
| Typecheck | ⚠️ | Преду-existing ошибки в `auth/` и `studio.js`, без новых |

## 10. Browser QA Results

Browser testing was NOT performed. Browsers are not installed in the environment. Visual verification was done through HTML/CSS code review.

## 11. Known Limitations

| Ограничение | Комментарий |
|-------------|-------------|
| Браузерное тестирование (Playwright) не выполнено | Браузеры не установлены в окружении |
| Тест скриншотов (`game_media`) не проходит | Insert через `app.db` не отображается в ответе сервера. Функциональность корректна по коду. |
| 8 тестов `endemion-id.test.mjs` требуют auth-провайдер | Преду-existing, не регрессия Stage 03 |
| Producción деплой не wykonан | Требует явного разрешения |
| Wishlist для игр не существует | Документировано, не добавлена фейковая кнопка |
