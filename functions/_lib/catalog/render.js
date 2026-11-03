// Разметка энциклопедии на сервере: постеры, карточки произведений и людей, факты, фрагменты страниц.
// Те же карточки рисует браузер (public/assets/ency.js) для подгружаемых списков — классы и структура совпадают.
// Всё, что пришло из источника, экранируется. Встроенных стилей нет: CSP запрещает style="…"

import { escapeHtml as e } from "../html.js";
import {
  AGE_RATINGS, characterPath, entryPath, KIND_LABELS, personPath, statusLabel, studioPath, typeLabel, unitsText
} from "./model.js";

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_ALONE = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/** «5 января 1941», «январь 1941» или «1941» — сколько известно */
export function partialDate(date) {
  if (!date?.year) return "";
  if (date.month && date.day) return `${date.day} ${MONTHS[date.month - 1]} ${date.year}`;
  if (date.month) return `${MONTHS_ALONE[date.month - 1]} ${date.year}`;
  return String(date.year);
}

/**
 * Постер с несколькими размерами: браузер берёт подходящий под ширину и плотность экрана.
 * lazy — для всего, что ниже первого экрана
 */
export function posterImg(poster, alt, { sizes = "(max-width: 680px) 44vw, 190px", lazy = true, className = "", priority = false } = {}) {
  if (!poster?.small) return `<span class="poster-empty${className ? ` ${className}` : ""}" role="img" aria-label="${e(alt)}">✦</span>`;
  const set = [[poster.small, 160], [poster.medium, 225], [poster.small2x, 320], [poster.medium2x, 450]]
    .filter(([url]) => url).map(([url, width]) => `${e(url)} ${width}w`).join(", ");
  return `<img${className ? ` class="${className}"` : ""} src="${e(poster.medium || poster.small)}" srcset="${set}" sizes="${e(sizes)}" ` +
    `width="225" height="320" alt="${e(alt)}" decoding="async" referrerpolicy="no-referrer"` +
    `${lazy ? ' loading="lazy"' : ""}${priority ? ' fetchpriority="high"' : ""}>`;
}

/** Фото персонажа или человека: у них другие пропорции */
export function portraitImg(image, alt, { lazy = true, className = "" } = {}) {
  if (!image?.small) return `<span class="poster-empty${className ? ` ${className}` : ""}" role="img" aria-label="${e(alt)}">✦</span>`;
  const set = [[image.small, 160], [image.medium, 225], [image.small2x, 320], [image.medium2x, 450]]
    .filter(([url]) => url).map(([url, width]) => `${e(url)} ${width}w`).join(", ");
  return `<img${className ? ` class="${className}"` : ""} src="${e(image.small)}" srcset="${set}" sizes="(max-width: 680px) 30vw, 160px" ` +
    `width="160" height="240" alt="${e(alt)}" decoding="async" referrerpolicy="no-referrer"${lazy ? ' loading="lazy"' : ""}>`;
}

const scoreBadge = (score) => (score ? `<span class="e-score" title="Оценка на Shikimori">★ ${Number(score).toFixed(2)}</span>` : "");

/** Карточка произведения: постер, оценка, название, год, тип, серии или главы, жанры */
export function entryCard(entry, { lazy = true, extra = "" } = {}) {
  const meta = [entry.year, typeLabel(entry.kind, entry.type), unitsText(entry)].filter(Boolean).join(" · ");
  const genres = (entry.genres || []).slice(0, 2).map((genre) => genre.name).join(" · ");
  return `<article class="e-card" data-kind="${entry.kind}" data-id="${entry.id}">
    <a class="e-cover" href="${e(entryPath(entry))}" tabindex="-1" aria-hidden="true">
      ${posterImg(entry.poster, "", { lazy })}
      ${scoreBadge(entry.score)}
      ${entry.status === "ongoing" ? '<span class="e-flag is-ongoing">Выходит</span>' : entry.status === "anons" ? '<span class="e-flag is-anons">Анонс</span>' : ""}
    </a>
    <div class="e-body">
      <h3 class="e-title"><a href="${e(entryPath(entry))}">${e(entry.title)}</a></h3>
      <p class="e-meta">${e(meta)}</p>
      ${genres ? `<p class="e-genres">${e(genres)}</p>` : ""}
      ${extra}
    </div>
  </article>`;
}

/** Карточка персонажа или человека: фото и имя, под именем — подпись (роль, произведение) */
export function personCard(item, { type = "character", note = "", lazy = true } = {}) {
  const path = type === "character" ? characterPath(item) : personPath(item);
  return `<article class="p-card">
    <a class="p-photo" href="${e(path)}" tabindex="-1" aria-hidden="true">${portraitImg(item.image, "", { lazy })}</a>
    <div class="p-body">
      <h3 class="p-name"><a href="${e(path)}">${e(item.name)}</a></h3>
      ${note ? `<p class="p-note">${e(note)}</p>` : ""}
    </div>
  </article>`;
}

/** Строка факта для блока «Информация». Пустые значения не выводятся */
export function fact(label, valueHtml) {
  return valueHtml ? `<div><dt>${e(label)}</dt><dd>${valueHtml}</dd></div>` : "";
}

export const studioLink = (studio) => `<a href="${e(studioPath(studio))}">${e(studio.name)}</a>`;
export const personLink = (person) => `<a href="${e(personPath(person))}">${e(person.name)}</a>`;

/** Ссылка на каталог с выбранным жанром */
export const genreLink = (kind, genre) => `<a class="tag" href="/${kind}?genres=${genre.id}">${e(genre.name)}</a>`;

export function kindLabel(kind) {
  return KIND_LABELS[kind];
}

export function ageLabel(rating) {
  return AGE_RATINGS[rating] || "";
}

export { statusLabel, typeLabel, unitsText };

/** Дата для schema.org: 1941-01-05, 1941-01 или 1941 */
export function isoDate(date) {
  if (!date?.year) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return [date.year, date.month && pad(date.month), date.month && date.day && pad(date.day)].filter(Boolean).join("-");
}

/** Сетка карточек или заглушка, если пусто */
export function grid(items, render, empty = "Здесь пока пусто.") {
  return items.length ? `<div class="e-grid">${items.map(render).join("")}</div>` : `<p class="muted">${e(empty)}</p>`;
}

/** Лента карточек с прокруткой вбок */
export function rail(items, render, id = "") {
  return `<div class="e-rail"${id ? ` id="${id}"` : ""}>${items.map(render).join("")}</div>`;
}
