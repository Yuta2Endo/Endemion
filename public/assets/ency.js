// Страницы энциклопедии, собранные на сервере (главная, каталоги, персонажи, люди, студии, сезоны, рейтинги, поиск):
// шапка с поиском, карусель на главной, кнопки «Добавить в список», рекомендации для вошедшего, фильтры каталога на телефоне

import { api, el, initHeader, stateBox } from "./app.js";
import { addToListDialog, entryCardNode, LIST_STATUSES } from "./ency-lib.js";

const page = document.querySelector("main")?.dataset.page || "";

// ==================== КАРУСЕЛЬ ====================

const SLIDE_MS = 7000;

function initHero() {
  const slides = [...document.querySelectorAll(".hero-slide")];
  const dots = [...document.querySelectorAll("[data-slide-to]")];
  if (slides.length < 2) return;
  let current = 0;
  let timer = null;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const show = (index) => {
    current = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      slide.hidden = i !== current;
      slide.classList.toggle("is-active", i === current);
    });
    dots.forEach((dot, i) => dot.setAttribute("aria-pressed", String(i === current)));
  };
  const start = () => {
    if (reduced) return;
    clearInterval(timer);
    timer = setInterval(() => show(current + 1), SLIDE_MS);
  };
  const stop = () => clearInterval(timer);

  dots.forEach((dot, i) => dot.addEventListener("click", () => {
    show(i);
    start();
  }));
  // Пока читают или нажимают кнопки, слайд не меняется
  const hero = document.querySelector(".hero");
  hero?.addEventListener("mouseenter", stop);
  hero?.addEventListener("mouseleave", start);
  hero?.addEventListener("focusin", stop);
  hero?.addEventListener("focusout", start);
  // Свайп на телефоне
  let touchX = null;
  hero?.addEventListener("touchstart", (event) => (touchX = event.touches[0].clientX), { passive: true });
  hero?.addEventListener("touchend", (event) => {
    if (touchX === null) return;
    const dx = event.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) {
      show(current + (dx < 0 ? 1 : -1));
      start();
    }
  });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();
}

// ==================== КНОПКИ «ДОБАВИТЬ В СПИСОК» ====================

function initListButtons(user, mine) {
  for (const node of document.querySelectorAll("[data-list-add]")) {
    if (!(node instanceof HTMLButtonElement)) continue;
    const { kind, title } = node.dataset;
    const id = Number(node.dataset.id);
    const draw = (item) => {
      node.textContent = item ? `✓ ${LIST_STATUSES[kind][item.status]}` : "＋ Добавить в список";
    };
    if (mine.has(`${kind}:${id}`)) draw(mine.get(`${kind}:${id}`));
    node.addEventListener("click", async () => {
      // Уже в списке — на страницу произведения, там меняется статус, оценка и прогресс
      if (user && mine.has(`${kind}:${id}`)) {
        const anchor = node.closest(".hero-copy")?.querySelector(".hero-title a");
        if (anchor instanceof HTMLAnchorElement) location.href = anchor.href;
        return;
      }
      const item = await addToListDialog(kind, id, title);
      if (item) {
        mine.set(`${kind}:${id}`, item);
        draw(item);
      }
    });
  }
}

/** Какие из произведений с кнопкой «Добавить в список» уже есть в списке пользователя (на главной их до пяти) */
async function loadMine(user) {
  const mine = new Map();
  if (!user) return mine;
  const buttons = [...document.querySelectorAll("[data-list-add]")].filter((node) => node instanceof HTMLElement);
  await Promise.all(buttons.map(async (node) => {
    const { kind, id } = /** @type {HTMLElement} */ (node).dataset;
    const result = await api(`/api/mylist/${kind}/${id}`);
    if (result.ok && result.data.item) mine.set(`${kind}:${Number(id)}`, result.data.item);
  }));
  return mine;
}

// ==================== РЕКОМЕНДАЦИИ ====================

async function initRecommendations(user) {
  const section = document.querySelector("#forYou");
  const box = document.querySelector("#forYouBody");
  if (!section || !box) return;
  section.hidden = false;
  if (!user) {
    box.replaceChildren(stateBox({
      icon: "✦", title: "Рекомендации по вашему вкусу",
      text: "Войдите и добавьте в список несколько аниме с оценками — здесь появится подборка похожего.",
      action: { href: `/auth?next=${encodeURIComponent("/")}`, text: "Войти" }
    }));
    return;
  }
  box.replaceChildren(el("p", "muted small", "Подбираем…"));
  const [anime, manga] = await Promise.all([api("/api/recommendations?kind=anime"), api("/api/recommendations?kind=manga")]);
  const blocks = [];
  for (const [result, label] of [[anime, "Аниме"], [manga, "Манга"]]) {
    if (!result.ok || !result.data.items.length) continue;
    const head = el("p", "filter-sub", `${label} · жанры: ${result.data.genres.map((genre) => genre.name).join(", ")}`);
    const rail = el("div", "e-rail");
    rail.append(...result.data.items.map((entry) => entryCardNode(entry)));
    blocks.push(head, rail);
  }
  if (!blocks.length) {
    const based = (anime.ok ? anime.data.basedOn : 0) + (manga.ok ? manga.data.basedOn : 0);
    box.replaceChildren(stateBox({
      icon: "✦", title: based ? "Пока мало оценок" : "Список пока пуст",
      text: based
        ? "Поставьте оценки просмотренному — рекомендации учитывают, что вам понравилось."
        : "Добавьте в список то, что смотрите или читаете, и поставьте оценки — здесь появится подборка.",
      action: { href: "/anime?order=ranked", text: "Открыть лучшее аниме" }
    }));
    return;
  }
  box.replaceChildren(...blocks);
}

// ==================== ФИЛЬТРЫ НА ТЕЛЕФОНЕ ====================

function initFilters() {
  const filters = document.querySelector("#filters");
  const open = document.querySelector(".filters-open");
  if (!(filters instanceof HTMLFormElement) || !open) return;
  const close = filters.querySelector(".filters-close");
  const setOpen = (value) => {
    filters.classList.toggle("open", value);
    open.setAttribute("aria-expanded", String(value));
    if (value) filters.querySelector("input, select")?.focus();
  };
  open.addEventListener("click", () => setOpen(true));
  close?.addEventListener("click", () => {
    setOpen(false);
    if (open instanceof HTMLElement) open.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && filters.classList.contains("open")) setOpen(false);
  });
  // Пустые поля не попадают в адрес: ссылка на выдачу остаётся короткой
  filters.addEventListener("submit", () => {
    for (const control of filters.elements) {
      if ((control instanceof HTMLInputElement || control instanceof HTMLSelectElement) && control.type !== "checkbox" && !control.value) {
        control.disabled = true;
      }
    }
  });
  // Сортировка и выпадающие списки применяются сразу на широком экране; на телефоне — по кнопке «Показать»
  for (const select of filters.querySelectorAll("select")) {
    select.addEventListener("change", () => {
      if (!filters.classList.contains("open")) filters.requestSubmit();
    });
  }
}

// ==================== СТАРТ ====================

async function init() {
  initHero();
  initFilters();
  const user = await initHeader();
  initListButtons(user, await loadMine(user));
  if (page === "home") initRecommendations(user);
}

init();

