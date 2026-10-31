// Читалка: листание страниц, лента, настройки, клавиши, свайпы и сохранение прогресса.
// Разметку со всеми страницами присылает сервер (functions/read/[id]/[chapter].js), здесь только поведение

import { api, getMe, loginUrl } from "./app.js";

const body = document.body;
const reader = document.querySelector("#reader");
const stage = document.querySelector("#readerStage");
const pages = [...stage.querySelectorAll(".reader-page")];
const end = document.querySelector("#readerEnd");
const counter = document.querySelector("#pageCounter");
const slider = document.querySelector("#pageSlider");
const progressBar = document.querySelector("#readProgress span");
const settingsPanel = document.querySelector("#readerSettings");
const settingsButton = document.querySelector("#settingsButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const chapterSelect = document.querySelector("#chapterSelect");
const endStatus = document.querySelector("#endStatus");

const titleId = Number(reader.dataset.titleId);
const chapter = Number(reader.dataset.chapter);
const total = Number(reader.dataset.pages);
const kind = body.dataset.kind;
const nextLink = document.querySelector('a[rel="next"]');
const prevLink = document.querySelector('a[rel="prev"]');

// ==================== НАСТРОЙКИ ====================

// Допустимые значения: из localStorage берётся только то, что есть в этом списке
const OPTIONS = {
  mode: ["paged", "strip"],
  direction: ["rtl", "ltr"],
  fit: ["height", "width"],
  width: ["narrow", "normal", "wide"],
  background: ["dark", "black", "light"]
};

// Манга по умолчанию листается справа налево, манхва и маньхуа — лентой
const DEFAULTS = kind === "page"
  ? { mode: "paged", direction: "rtl", fit: "height", width: "normal", background: "dark" }
  : { mode: "strip", direction: "ltr", fit: "width", width: "normal", background: "dark" };

const SETTINGS_KEY = `endemion:reader:${kind}`;
const POSITION_KEY = `endemion:position:${titleId}:${chapter}`;

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const settings = { ...DEFAULTS };
const stored = readStorage(SETTINGS_KEY);
if (stored && typeof stored === "object") {
  for (const [name, values] of Object.entries(OPTIONS)) {
    if (values.includes(stored[name])) settings[name] = stored[name];
  }
}

// Цвет панели браузера совпадает с фоном читалки
const THEME_COLORS = { dark: "#05070f", black: "#000000", light: "#e7e8ee" };
const themeColor = document.querySelector('meta[name="theme-color"]');

function applySettings() {
  for (const name of Object.keys(OPTIONS)) body.dataset[name] = settings[name];
  themeColor?.setAttribute("content", THEME_COLORS[settings.background]);
  for (const input of settingsPanel.querySelectorAll("input[type=radio]")) {
    input.checked = settings[input.name] === input.value;
  }
}

settingsPanel.addEventListener("change", (event) => {
  const { name, value } = event.target;
  if (!OPTIONS[name]?.includes(value)) return;
  const page = current;
  settings[name] = value;
  writeStorage(SETTINGS_KEY, settings);
  applySettings();
  // После смены режима читатель остаётся на той же странице
  if (name === "mode" || name === "fit" || name === "width") show(page, { scroll: true });
});

function toggleSettings(open = settingsPanel.hidden) {
  settingsPanel.hidden = !open;
  settingsButton.setAttribute("aria-expanded", String(open));
  if (open) {
    setUiHidden(false);
    settingsPanel.querySelector("input:checked")?.focus();
  }
}

settingsButton.addEventListener("click", () => toggleSettings());

document.addEventListener("click", (event) => {
  if (!settingsPanel.hidden && !settingsPanel.contains(event.target) && !settingsButton.contains(event.target)) {
    toggleSettings(false);
  }
});

// ==================== ПОЗИЦИЯ ====================

// current — номер страницы от 1 до total; total + 1 — экран «Глава прочитана»
let current = 1;
const isPaged = () => settings.mode === "paged";
const forward = () => (settings.direction === "rtl" ? -1 : 1);

function updatePosition() {
  const onEnd = current > total;
  counter.textContent = onEnd ? "Конец главы" : `${current} / ${total}`;
  slider.value = String(Math.min(current, total));
  if (isPaged()) progressBar.style.width = `${Math.round((Math.min(current, total) / total) * 100)}%`;
  if (!onEnd) {
    // После дочитывания позиция не перезаписывается: следующее открытие главы начнётся сначала
    if (!chapterDone) writeStorage(POSITION_KEY, current);
    history.replaceState(null, "", current > 1 ? `#${current}` : location.pathname);
  }
  if (onEnd) finishChapter();
}

/** Картинки рядом с текущей грузятся заранее, чтобы листание было мгновенным */
function preload(page) {
  for (const n of [page, page + 1, page + 2, page - 1]) {
    const image = pages[n - 1];
    if (image && image.loading !== "eager") image.loading = "eager";
  }
}

function show(page, { scroll = false } = {}) {
  current = Math.max(1, Math.min(total + 1, page));
  if (isPaged()) {
    pages.forEach((image, i) => image.classList.toggle("is-current", i + 1 === current));
    end.classList.toggle("is-current", current > total);
    preload(current);
    window.scrollTo({ top: 0 });
  } else if (scroll) {
    const target = current > total ? end : pages[current - 1];
    preload(current);
    target.scrollIntoView({ block: "start" });
  }
  updatePosition();
}

function step(delta) {
  if (current + delta > total + 1) {
    // Дальше конца главы — следующая глава
    if (nextLink) location.href = nextLink.href;
    return;
  }
  if (current + delta < 1) {
    if (prevLink) location.href = prevLink.href;
    return;
  }
  show(current + delta);
}

slider.addEventListener("input", () => show(Number(slider.value)));

chapterSelect.addEventListener("change", () => {
  location.href = `/read/${titleId}/${chapterSelect.value}`;
});

// ==================== СТРАНИЦЫ: КЛИКИ И СВАЙПЫ ====================

let swipeStart = null;
let swiped = false;
// Пальцы на экране: второй палец означает pinch-zoom, а не свайп
const touches = new Set();
const isZoomed = () => (window.visualViewport?.scale ?? 1) > 1.01;

// В увеличенной странице палец двигает её в любую сторону, а листание свайпом отключено
window.visualViewport?.addEventListener("resize", () => body.classList.toggle("is-zoomed", isZoomed()));

stage.addEventListener("pointerdown", (event) => {
  swiped = false;
  if (event.pointerType === "mouse") return;
  touches.add(event.pointerId);
  swipeStart = touches.size === 1 ? { x: event.clientX, y: event.clientY } : null;
});

function releaseTouch(event) {
  touches.delete(event.pointerId);
}

stage.addEventListener("pointercancel", (event) => {
  releaseTouch(event);
  swipeStart = null;
});

stage.addEventListener("pointerup", (event) => {
  releaseTouch(event);
  if (!swipeStart || !isPaged() || isZoomed()) {
    swipeStart = null;
    return;
  }
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    swiped = true;
    // Свайп влево двигает страницу влево: в манге справа налево это шаг назад
    step(dx < 0 ? forward() : -forward());
  }
});

stage.addEventListener("click", (event) => {
  if (swiped || event.target.closest("a, button, .reader-end")) return;
  if (!settingsPanel.hidden) return;
  if (!isPaged()) {
    setUiHidden(!body.classList.contains("ui-hidden"));
    return;
  }
  const share = event.clientX / window.innerWidth;
  if (share < 0.35) step(-forward());
  else if (share > 0.65) step(forward());
  else setUiHidden(!body.classList.contains("ui-hidden"));
});

// ==================== ЛЕНТА: ПРОКРУТКА ====================

let lastScroll = window.scrollY;
let ticking = false;

function onScroll() {
  ticking = false;
  if (isPaged()) return;

  const max = document.documentElement.scrollHeight - window.innerHeight;
  progressBar.style.width = `${max > 0 ? Math.round((window.scrollY / max) * 100) : 100}%`;

  // Текущая страница — та, что пересекает середину экрана
  const middle = window.innerHeight / 2;
  let page = current;
  if (end.getBoundingClientRect().top < middle) page = total + 1;
  else {
    const found = pages.findIndex((image) => {
      const rect = image.getBoundingClientRect();
      return rect.top <= middle && rect.bottom > middle;
    });
    if (found >= 0) page = found + 1;
  }
  if (page !== current) {
    current = page;
    updatePosition();
  }

  // Вниз — панели прячутся, вверх — возвращаются
  const delta = window.scrollY - lastScroll;
  if (Math.abs(delta) > 8 && settingsPanel.hidden) setUiHidden(delta > 0 && window.scrollY > 80);
  lastScroll = window.scrollY;
}

window.addEventListener("scroll", () => {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(onScroll);
  }
}, { passive: true });

function setUiHidden(hidden) {
  body.classList.toggle("ui-hidden", hidden);
}

// ==================== КЛАВИАТУРА И ПОЛНЫЙ ЭКРАН ====================

document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "Escape" && !settingsPanel.hidden) {
    toggleSettings(false);
    settingsButton.focus();
    return;
  }
  if (event.target.closest("input, select, textarea, .reader-settings")) return;
  // На кнопке или ссылке пробел должен нажимать её, а не листать
  if (event.key === " " && event.target.closest("a, button")) return;

  if (event.key === "f" || event.key === "F" || event.key === "а" || event.key === "А") {
    toggleFullscreen();
    return;
  }
  if (!isPaged()) return;

  const keys = {
    ArrowRight: settings.direction === "rtl" ? -1 : 1,
    ArrowLeft: settings.direction === "rtl" ? 1 : -1,
    PageDown: 1,
    PageUp: -1,
    " ": event.shiftKey ? -1 : 1
  };
  if (event.key in keys) {
    event.preventDefault();
    const delta = keys[event.key];
    const isArrow = event.key === "ArrowRight" || event.key === "ArrowLeft";
    if (!isArrow && scrollWithinPage(delta)) return;
    step(delta);
  } else if (event.key === "Home") {
    event.preventDefault();
    show(1);
  } else if (event.key === "End") {
    event.preventDefault();
    show(total);
  }
});

/** В масштабе «По ширине» страница бывает выше экрана: пробел и PageDown сначала докручивают её до конца */
function scrollWithinPage(delta) {
  if (settings.fit !== "width") return false;
  const distance = window.innerHeight * 0.85;
  if (delta > 0) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (window.scrollY < max - 2) {
      window.scrollBy({ top: distance });
      return true;
    }
  } else if (window.scrollY > 2) {
    window.scrollBy({ top: -distance });
    return true;
  }
  return false;
}

function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

if (document.fullscreenEnabled) {
  fullscreenButton.hidden = false;
  fullscreenButton.addEventListener("click", toggleFullscreen);
}

// ==================== ПРОГРЕСС В ПРОФИЛЕ ====================

// chapterDone — глава дочитана в этом открытии (позиция больше не сохраняется);
// finished — прогресс отправлен или отправляется, при ошибке сбрасывается для повторной попытки
let chapterDone = false;
let finished = false;

/** Дочитал главу — в профиле отмечается эта глава. Прогресс не уменьшается, если перечитываешь старую главу */
async function finishChapter() {
  if (!chapterDone) {
    chapterDone = true;
    writeStorage(POSITION_KEY, 1);
  }
  if (finished) return;
  finished = true;

  try {
    const { user } = await getMe();
    if (!user) {
      endStatus.replaceChildren();
      const link = document.createElement("a");
      link.href = loginUrl();
      link.textContent = "Войдите";
      endStatus.append(link, ", чтобы Endemion запоминал прочитанные главы.");
      return;
    }

    const library = await api("/api/library");
    const entry = library.ok ? library.data.items.find((item) => item.titleId === titleId) : null;
    if (entry && entry.chapter >= chapter) {
      endStatus.textContent = `В профиле отмечено ${entry.chapter} из ${reader.dataset.chapters} глав.`;
      return;
    }

    const result = await api(`/api/library/${titleId}`, { method: "PUT", body: { chapter } });
    endStatus.textContent = result.ok
      ? `Сохранено: прочитано ${chapter} из ${reader.dataset.chapters} глав.`
      : result.data?.error || "Не удалось сохранить прогресс.";
    if (!result.ok) finished = false;
  } catch {
    // Сеть недоступна: при следующем показе экрана «Глава прочитана» будет новая попытка
    endStatus.textContent = "Не удалось сохранить прогресс: нет связи с сервером.";
    finished = false;
  }
}

// ==================== СТАРТ ====================

applySettings();

// Страница из адреса (#5) или место, где остановился в прошлый раз
const fromHash = Number(location.hash.slice(1));
const saved = Number(readStorage(POSITION_KEY));
const start = Number.isInteger(fromHash) && fromHash >= 1 && fromHash <= total ? fromHash
  : Number.isInteger(saved) && saved > 1 && saved <= total ? saved : 1;

if (isPaged()) {
  show(start);
} else if (start > 1) {
  // В ленте картинки выше нужной имеют размеры из width/height, поэтому прокрутка сразу попадает на место
  show(start, { scroll: true });
} else {
  updatePosition();
  onScroll();
}

// Нужная страница уже на месте: можно показать (класс ставит reader-init.js)
body.classList.remove("reader-pending");

stage.focus({ preventScroll: true });
