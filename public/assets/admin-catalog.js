// Разделы админки энциклопедии: источник данных (проверка, кеш, ошибки интеграции), настройки каталога
// (взрослый контент, скрытые жанры, произведение для главной) и модерация отзывов о произведениях.
// Права проверяет сервер: каталог — только администратору, отзывы — модератору и администратору

import { api, button, el, link, timeAgo, toast } from "./app.js";

const $ = (selector) => document.querySelector(selector);

function setMessage(node, text, success = false) {
  node.textContent = text;
  node.classList.toggle("success", success);
}

function statCard(label, value, note, alert = false) {
  const card = el("div", `admin-stat${alert ? " is-alert" : ""}`);
  card.append(el("span", null, label), el("strong", null, String(value)), el("small", null, note));
  return card;
}

const kb = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`);

// ==================== КАТАЛОГ ====================

let settings = null;

function genreChecks(kind, genres, hidden) {
  const box = el("div", "admin-tag-picker");
  const chosen = new Set(hidden);
  for (const genre of genres) {
    const label = el("label", "admin-tag-chip");
    const input = el("input");
    input.type = "checkbox";
    input.name = `hidden-${kind}`;
    input.value = String(genre.id);
    input.checked = chosen.has(genre.id);
    label.append(input, document.createTextNode(` ${genre.name}`));
    box.append(label);
  }
  return box;
}

export async function loadCatalog() {
  const statusBox = $("#catalogStatus");
  const errorsList = $("#catalogErrors");
  const message = $("#catalogMessage");
  setMessage(message, "Проверяем источник…");
  const result = await api("/api/admin/catalog");
  if (!result.ok) {
    setMessage(message, result.data?.error || "Не удалось загрузить данные каталога.");
    return;
  }
  const data = result.data;
  settings = data.settings;
  setMessage(message, "");
  statusBox.replaceChildren(
    statCard("Источник", data.provider.label, data.ping.ok ? `отвечает за ${data.ping.ms} мс` : `не отвечает: ${data.ping.error}`, !data.ping.ok),
    statCard("Кеш", data.cache.total, `свежих: ${data.cache.fresh} · ${kb(data.cache.bytes)}`),
    statCard("Ошибки за сутки", data.errorsDay, `в очереди: ${data.queue.pending}, запросов/мин: ${data.queue.requestsLastMinute}`, data.errorsDay > 0),
    statCard("Списки", data.counts.listItems, `пользователей: ${data.counts.listUsers} · произведений: ${data.counts.entries}`),
    statCard("Избранное", data.counts.favorites, "записей у всех пользователей"),
    statCard("Отзывы", data.counts.reviews, `скрыто модераторами: ${data.counts.reviewsHidden}`)
  );

  errorsList.replaceChildren(...(data.errors.length ? data.errors.map((item) => {
    const row = el("li", "admin-audit-entry");
    row.append(
      el("strong", null, `${item.operation}${item.status ? ` · HTTP ${item.status}` : ""}`),
      el("span", null, item.message),
      el("small", null, `${item.provider} · ${timeAgo(item.createdAt)}`)
    );
    return row;
  }) : [el("li", "admin-empty", "Ошибок нет.")]));

  $("#allowAdult").checked = settings.allowAdult;
  $("#hiddenAnime").replaceChildren(data.genres.anime.length
    ? genreChecks("anime", data.genres.anime, settings.hiddenGenres.anime)
    : el("p", "admin-hint", "Жанры не загрузились: источник недоступен."));
  $("#hiddenManga").replaceChildren(data.genres.manga.length
    ? genreChecks("manga", data.genres.manga, settings.hiddenGenres.manga)
    : el("p", "admin-hint", "Жанры не загрузились: источник недоступен."));
  $("#heroKind").value = settings.hero?.kind || "anime";
  $("#heroId").value = settings.hero ? String(settings.hero.id) : "";
}

async function saveSettings(event) {
  event.preventDefault();
  const message = $("#catalogSettingsMessage");
  const form = $("#catalogSettingsForm");
  const hidden = (kind) => [...form.querySelectorAll(`input[name="hidden-${kind}"]:checked`)].map((input) => Number(input.value));
  const heroId = $("#heroId").value.trim();
  if (heroId && !/^\d{1,9}$/.test(heroId)) return setMessage(message, "Номер произведения — только цифры, как в адресе страницы.");
  const body = {
    allowAdult: $("#allowAdult").checked,
    // Если жанры не загрузились, прежний список сохраняется как есть
    hiddenGenres: {
      anime: form.querySelector('input[name="hidden-anime"]') ? hidden("anime") : settings.hiddenGenres.anime,
      manga: form.querySelector('input[name="hidden-manga"]') ? hidden("manga") : settings.hiddenGenres.manga
    },
    hero: heroId ? { kind: $("#heroKind").value, id: Number(heroId) } : null
  };
  setMessage(message, "Сохраняем…");
  const result = await api("/api/admin/catalog/settings", { method: "PUT", body });
  if (!result.ok) return setMessage(message, result.data?.error || "Не удалось сохранить.");
  settings = result.data.settings;
  setMessage(message, "Сохранено. Главная и каталог обновятся при следующем открытии.", true);
}

async function clearCache() {
  if (!confirm("Очистить кеш каталога? Следующие страницы будут загружаться из источника заново, чуть медленнее.")) return;
  const result = await api("/api/admin/catalog/cache", { method: "POST", body: {} });
  if (!result.ok) return toast(result.data?.error || "Не удалось очистить кеш.");
  toast(`Кеш очищен: ${result.data.removed} записей`);
  loadCatalog();
}

async function clearErrors() {
  if (!confirm("Очистить журнал ошибок интеграции?")) return;
  const result = await api("/api/admin/catalog/errors", { method: "DELETE" });
  if (!result.ok) return toast(result.data?.error || "Не удалось очистить журнал.");
  loadCatalog();
}

// ==================== ОТЗЫВЫ ====================

let reviewsOffset = 0;

function reviewItem(review) {
  const item = el("li", "admin-complaint");
  const head = el("div", "admin-title-head");
  head.append(
    link(`/${review.kind}/${review.entryId}#review-${review.id}`, null, `«${review.entry.title}»`),
    el("span", "admin-tag", `${review.score}/10`),
    ...(review.hidden ? [el("span", "admin-tag is-moderator", "скрыт")] : [])
  );
  const author = el("p", "admin-hint", `${review.author.name}${review.author.username ? ` (@${review.author.username})` : ""} · ${timeAgo(review.createdAt)}`);
  const text = el("p", "admin-complaint-text", review.body.length > 600 ? `${review.body.slice(0, 600)}…` : review.body);
  const actions = el("div", "admin-actions");
  const act = async (action) => {
    const reason = action === "remove" ? prompt("Причина (необязательно, автор увидит её в уведомлении):", "") : "";
    if (reason === null) return;
    const result = await api("/api/moderation/actions", {
      method: "POST", body: { targetType: "entry_review", targetId: review.id, action, reason }
    });
    if (!result.ok) return toast(result.data?.error || "Не удалось.");
    toast(action === "remove" ? "Отзыв скрыт" : "Отзыв снова виден");
    loadReviews(true);
  };
  actions.append(review.hidden
    ? button("Вернуть", "secondary-button", () => act("restore"))
    : button("Скрыть", "secondary-button", () => act("remove")));
  actions.append(button("Удалить", "danger-button", async () => {
    if (!confirm("Удалить отзыв навсегда?")) return;
    const result = await api(`/api/entry-reviews/${review.id}`, { method: "DELETE" });
    if (!result.ok) return toast(result.data?.error || "Не удалось удалить.");
    toast("Отзыв удалён");
    loadReviews(true);
  }));
  item.append(head, author, text, actions);
  return item;
}

export async function loadReviews(reset = true) {
  const list = $("#entryReviewList");
  const message = $("#entryReviewsMessage");
  const more = $("#entryReviewsMore");
  if (reset) reviewsOffset = 0;
  const hidden = $("#entryReviewFilter").value === "hidden" ? "1" : "0";
  const result = await api(`/api/admin/entry-reviews?hidden=${hidden}&offset=${reviewsOffset}`);
  if (!result.ok) return setMessage(message, result.data?.error || "Отзывы не загрузились.");
  setMessage(message, result.data.total ? `Всего: ${result.data.total}` : "");
  if (reset) list.replaceChildren();
  if (reset && !result.data.reviews.length) list.append(el("li", "admin-empty", "Отзывов нет."));
  list.append(...result.data.reviews.map(reviewItem));
  reviewsOffset += result.data.reviews.length;
  more.hidden = reviewsOffset >= result.data.total;
}

/** Обработчики форм. Вызывается один раз при открытии админки */
export function initCatalogAdmin() {
  $("#catalogSettingsForm")?.addEventListener("submit", saveSettings);
  $("#catalogRefresh")?.addEventListener("click", loadCatalog);
  $("#catalogClearCache")?.addEventListener("click", clearCache);
  $("#catalogClearErrors")?.addEventListener("click", clearErrors);
  $("#entryReviewFilter")?.addEventListener("change", () => loadReviews(true));
  $("#entryReviewsMore")?.addEventListener("click", () => loadReviews(false));
}
