// Общий код страниц энциклопедии: подписи типов и статусов, карточка произведения, запросы к спискам и избранному.
// Подписи совпадают с functions/_lib/catalog/model.js, карточка — с entryCard из functions/_lib/catalog/render.js

import { api, askLogin, el, entryUrl, escapeHtml, field, getMe, link, openDialog, remoteImage, toast } from "./app.js";

export const LIST_STATUSES = {
  anime: { planned: "Планирую смотреть", current: "Смотрю", completed: "Просмотрено", on_hold: "Отложено", dropped: "Брошено" },
  manga: { planned: "Планирую читать", current: "Читаю", completed: "Прочитано", on_hold: "Отложено", dropped: "Брошено" }
};

export const SCORE_LABELS = {
  10: "Шедевр", 9: "Великолепно", 8: "Отлично", 7: "Хорошо", 6: "Неплохо", 5: "Средне", 4: "Слабо", 3: "Плохо", 2: "Ужасно", 1: "Хуже некуда"
};

const TYPES = {
  anime: { tv: "TV", movie: "Фильм", ova: "OVA", ona: "ONA", special: "Спешл", tv_special: "TV-спешл", music: "Клип", pv: "Проморолик", cm: "Реклама" },
  manga: { manga: "Манга", manhwa: "Манхва", manhua: "Маньхуа", light_novel: "Ранобэ", novel: "Новелла", one_shot: "Ваншот", doujin: "Додзинси" }
};

export const typeLabel = (kind, type) => TYPES[kind]?.[type] || "";

/** «12 эп.», «141 гл.», для выходящего аниме — «5 из 12 эп.» */
export function unitsText(entry) {
  const unit = entry.kind === "anime" ? "эп." : "гл.";
  if (entry.kind === "anime" && entry.status === "ongoing" && entry.unitsAired) return `${entry.unitsAired} из ${entry.units || "?"} ${unit}`;
  return entry.units ? `${entry.units} ${unit}` : "";
}

export const entryMeta = (entry) => [entry.year, typeLabel(entry.kind, entry.type), unitsText(entry)].filter(Boolean).join(" · ");

/** Постер с несколькими размерами, как на сервере */
export function posterNode(poster, alt = "") {
  const img = remoteImage(poster?.medium || poster?.small, alt);
  if (img instanceof HTMLImageElement) {
    img.srcset = [[poster.small, 160], [poster.medium, 225], [poster.small2x, 320], [poster.medium2x, 450]]
      .filter(([url]) => url).map(([url, width]) => `${url} ${width}w`).join(", ");
    img.sizes = "(max-width: 680px) 44vw, 190px";
    img.width = 225;
    img.height = 320;
  }
  return img;
}

/** Карточка произведения: постер, оценка, название, год, тип, серии или главы, жанры */
export function entryCardNode(entry, { extra = null } = {}) {
  const card = el("article", "e-card");
  const cover = link(entryUrl(entry), "e-cover", null);
  cover.tabIndex = -1;
  cover.setAttribute("aria-hidden", "true");
  cover.append(posterNode(entry.poster));
  if (entry.score) cover.append(el("span", "e-score", `★ ${Number(entry.score).toFixed(2)}`));
  if (entry.status === "ongoing") cover.append(el("span", "e-flag is-ongoing", "Выходит"));
  else if (entry.status === "anons") cover.append(el("span", "e-flag is-anons", "Анонс"));
  const body = el("div", "e-body");
  const title = el("h3", "e-title");
  title.append(link(entryUrl(entry), null, entry.title));
  body.append(title, el("p", "e-meta", entryMeta(entry)));
  const genres = (entry.genres || []).slice(0, 2).map((genre) => genre.name).join(" · ");
  if (genres) body.append(el("p", "e-genres", genres));
  if (extra) body.append(...[].concat(extra));
  card.append(cover, body);
  return card;
}

// ==================== СПИСКИ И ИЗБРАННОЕ ====================

/** Изменить запись списка. Возвращает новую запись или null (гостю предлагает войти, ошибку показывает) */
export async function saveListItem(kind, id, changes) {
  const { user } = await getMe();
  if (!user) {
    askLogin("Чтобы вести свой список, войдите в профиль.");
    return null;
  }
  const result = await api(`/api/mylist/${kind}/${id}`, { method: "PUT", body: changes });
  if (!result.ok) {
    toast(result.data?.error || "Не удалось сохранить. Попробуйте ещё раз.");
    return null;
  }
  return result.data.item;
}

/** Убрать из списка. true — получилось */
export async function removeListItem(kind, id) {
  const result = await api(`/api/mylist/${kind}/${id}`, { method: "DELETE" });
  if (!result.ok) toast(result.data?.error || "Не удалось убрать из списка.");
  return result.ok;
}

/** Добавить в избранное или убрать. Возвращает новое состояние или null */
export async function setFavorite(type, id, on) {
  const { user } = await getMe();
  if (!user) {
    askLogin("Чтобы собирать избранное, войдите в профиль.");
    return null;
  }
  const result = await api(`/api/favorites/${type}/${id}`, { method: on ? "PUT" : "DELETE" });
  if (!result.ok) {
    toast(result.data?.error || "Не удалось изменить избранное.");
    return null;
  }
  return result.data.favorite;
}

/** Кнопка «В избранное»: сама переключает состояние и подпись */
export function favoriteButton(type, id, initial) {
  let on = initial;
  const node = el("button", "ghost-btn fav-btn");
  node.type = "button";
  const draw = () => {
    node.textContent = on ? "♥ В избранном" : "♡ В избранное";
    node.setAttribute("aria-pressed", String(on));
  };
  node.addEventListener("click", async () => {
    node.disabled = true;
    const next = await setFavorite(type, id, !on);
    node.disabled = false;
    if (next === null) return;
    on = next;
    draw();
    toast(on ? "Добавлено в избранное" : "Убрано из избранного");
  });
  draw();
  return node;
}

/** Окно «Добавить в список» с выбором статуса. Возвращает запись или null */
export async function addToListDialog(kind, id, title) {
  const { user } = await getMe();
  if (!user) {
    askLogin("Чтобы вести свой список, войдите в профиль.");
    return null;
  }
  let saved = null;
  await openDialog({
    title: `«${title}» — в список`,
    submitText: "Добавить",
    build(form) {
      const select = el("select", "select");
      select.name = "status";
      for (const [value, label] of Object.entries(LIST_STATUSES[kind])) select.append(new Option(label, value));
      form.append(field("Статус", select));
    },
    async onSubmit(form) {
      const status = /** @type {HTMLSelectElement} */ (form.elements.namedItem("status")).value;
      const result = await api(`/api/mylist/${kind}/${id}`, { method: "PUT", body: { status } });
      if (!result.ok) return result.data?.error || "Не удалось добавить.";
      saved = result.data.item;
      return null;
    }
  });
  if (saved) {
    toast(`«${escapeHtml(title)}»: ${escapeHtml(LIST_STATUSES[kind][saved.status])}. <a href="/mylist">Мой список</a>`, { html: true, duration: 5000 });
  }
  return saved;
}
