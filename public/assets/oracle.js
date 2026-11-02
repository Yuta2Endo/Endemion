// ENDEMION ORACLE: выбор настроения и рекомендации с объяснением. Настроение и тайтл для «похожего» — в адресе

import {
  api, button, el, errorBox, getLibrary, getMe, initHeader, link, stateBox, thumb, titleCard, titlePicker, toggleFavorite
} from "./app.js";

const moodsBox = document.querySelector("#moods");
const results = document.querySelector("#oracleResults");
const note = document.querySelector("#oracleNote");
const similarBox = document.querySelector("#similarBox");
const typeSelect = document.querySelector("#oracleType");
const seenBox = document.querySelector("#seenBox");
const seenInput = document.querySelector("#oracleSeen");

const ICONS = { strong_hero: "⚔", dark: "🌑", romance: "🌹", adventure: "🧭", twist: "🌀", similar: "◎", hidden_gem: "💎" };

let moods = [];
let mood = null;
let similarTitle = null;
let library = new Map();
let user = null;
let requestId = 0;

function writeUrl() {
  const params = new URLSearchParams();
  if (mood) params.set("mood", mood);
  if (mood === "similar" && similarTitle) params.set("title", String(similarTitle.id));
  if (typeSelect.value) params.set("type", typeSelect.value);
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
}

function renderMoods() {
  moodsBox.replaceChildren(...moods.map((item) => {
    const card = button("", "mood-card", () => choose(item.key), { pressed: item.key === mood });
    card.append(el("span", "mood-icon", ICONS[item.key] || "✦"), el("strong", null, item.label));
    return card;
  }));
}

function renderSimilar() {
  similarBox.hidden = mood !== "similar";
  if (mood !== "similar") return;
  similarBox.replaceChildren();
  if (similarTitle) {
    const chosen = el("div", "picked");
    const tag = el("span", "tag is-strong");
    tag.append(thumb(similarTitle, "picker-thumb"), document.createTextNode(` Похоже на «${similarTitle.title}» `),
      button("✕", null, () => {
        similarTitle = null;
        renderSimilar();
        run();
      }, { label: "Выбрать другой тайтл" }));
    chosen.append(tag);
    similarBox.append(chosen);
  } else {
    const picker = titlePicker({
      placeholder: "На что должно быть похоже?",
      onPick(title) {
        similarTitle = title;
        renderSimilar();
        run();
      }
    });
    similarBox.append(picker.root);
    picker.input.focus();
  }
}

function choose(key) {
  mood = key;
  renderMoods();
  renderSimilar();
  run();
}

async function run() {
  writeUrl();
  if (!mood) {
    note.textContent = "";
    results.replaceChildren(stateBox({ icon: "✦", title: "Выберите настроение", text: "Oracle подберёт истории и объяснит, почему они подходят." }));
    return;
  }
  if (mood === "similar" && !similarTitle) {
    note.textContent = "";
    results.replaceChildren(stateBox({ icon: "◎", text: "Выберите произведение, на которое должно быть похоже." }));
    return;
  }
  const id = ++requestId;
  results.replaceChildren(...Array.from({ length: 4 }, () => {
    const box = el("div", "skeleton skeleton-row");
    box.setAttribute("aria-hidden", "true");
    return box;
  }));
  const params = new URLSearchParams({ limit: "12" });
  if (mood === "similar") params.set("title", String(similarTitle.id));
  if (typeSelect.value) params.set("type", typeSelect.value);
  if (seenInput.checked) params.set("seen", "1");
  const result = await api(`/api/oracle/${mood}?${params}`);
  if (id !== requestId) return;
  if (!result.ok) {
    results.replaceChildren(errorBox(result.data?.error || "Рекомендации не загрузились.", run));
    note.textContent = "";
    return;
  }
  const { items, personalized } = result.data;
  note.replaceChildren(el("span", null, personalized
    ? "✦ С учётом вашей полки, оценок и любимых жанров. Тайтлы с полки не показываются."
    : user ? "Добавьте тайтлы на полку или оцените прочитанное — рекомендации станут точнее." : "Войдите, чтобы рекомендации учитывали ваш вкус."));
  if (!user) note.append(document.createTextNode(" "), link(`/auth?next=${encodeURIComponent(location.pathname + location.search)}`, "link-btn", "Войти"));
  if (!items.length) {
    results.replaceChildren(stateBox({
      icon: "🔭", title: "Ничего не подошло",
      text: seenInput.checked || !user ? "Попробуйте другое настроение или тип." : "Возможно, всё подходящее уже на вашей полке. Включите «Показывать то, что уже на полке».",
    }));
    return;
  }
  results.replaceChildren(...items.map((item) => titleCard(item.title, {
    wide: true, library: library.get(item.title.id), onFavorite: toggleFavorite, reasons: item.reasons, description: false
  })));
}

typeSelect.addEventListener("change", run);
seenInput.addEventListener("change", run);

async function init() {
  user = await initHeader();
  library = await getLibrary();
  seenBox.hidden = !user;
  const result = await api("/api/oracle");
  if (!result.ok) {
    moodsBox.replaceChildren(errorBox(result.data?.error || "Не удалось загрузить настроения.", init));
    return;
  }
  moods = result.data.moods;
  const params = new URLSearchParams(location.search);
  const wanted = params.get("mood");
  if (moods.some((item) => item.key === wanted)) mood = wanted;
  if (params.get("type")) typeSelect.value = params.get("type");
  const titleParam = Number(params.get("title"));
  if (mood === "similar" && Number.isInteger(titleParam) && titleParam > 0) {
    const found = await api(`/api/titles/${titleParam}`);
    if (found.ok) similarTitle = found.data.title;
  }
  renderMoods();
  renderSimilar();
  run();
}

getMe();
init();
