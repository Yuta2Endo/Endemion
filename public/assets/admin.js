// Админка: тайтлы, главы и загрузка страниц. Права проверяет сервер в каждом запросе /api/admin/*,
// эта страница только показывает формы

import { api, chaptersText, getMe, loginUrl, posterBackground, toast, TYPE_LABELS } from "./app.js";

const $ = (selector) => document.querySelector(selector);

const adminLayout = $("#admin");
const denied = $("#denied");
const titleList = $("#titleList");
const titleForm = $("#titleForm");
const titleHeading = $("#titleFormHeading");
const titleMessage = $("#titleMessage");
const deleteTitleButton = $("#deleteTitleButton");
const viewTitleLink = $("#viewTitleLink");
const posterPreview = $("#posterPreview");
const chaptersSection = $("#chaptersSection");
const chapterForm = $("#chapterForm");
const chapterHeading = $("#chapterFormHeading");
const chapterCancel = $("#chapterCancel");
const chapterMessage = $("#chapterMessage");
const chapterList = $("#chapterList");
const coverField = $("#coverField");
const coverInput = $("#coverInput");
const coverRemove = $("#coverRemove");
const MAX_COVER_BYTES = 5 * 1024 * 1024;

const DEFAULT_COLORS = ["#1f2a4d", "#5d4a8a", "#e3b5c9"];
// Те же ограничения проверяет сервер (functions/_lib/admin.js)
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_PAGE_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 500;
const PARALLEL_UPLOADS = 3;

let titles = [];
// Выбранный тайтл; null — форма нового тайтла
let current = null;
let chapters = [];
// Номер главы в форме; null — новая глава
let editing = null;
let uploading = false;

const titleField = (name) => titleForm.elements.namedItem(name);
const chapterField = (name) => chapterForm.elements.namedItem(name);
const titleUrl = (id) => `/api/admin/titles/${id}`;
const chapterUrl = (number) => `${titleUrl(current.id)}/chapters/${number}`;

function setMessage(node, text, success = false) {
  node.textContent = text;
  node.classList.toggle("success", success);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, onClick) {
  const node = element("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function formatDate(value) {
  return new Date(`${value.replace(" ", "T")}Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Пока идёт загрузка страниц, переключаться и менять главы нельзя: черновик остался бы недогруженным */
function busy() {
  if (uploading) toast("Дождитесь окончания загрузки страниц.");
  return uploading;
}

// ==================== ТАЙТЛЫ ====================

function renderTitles() {
  if (!titles.length) {
    titleList.replaceChildren(element("li", "admin-empty", "Тайтлов пока нет."));
    return;
  }
  titleList.replaceChildren(...titles.map((title) => {
    const item = element("li");
    const node = button("", "admin-title-item", () => selectTitle(title.id));
    node.setAttribute("aria-current", String(title.id === current?.id));
    node.append(element("strong", null, title.title), element("small", null, `${TYPE_LABELS[title.type]} · ${chaptersText(title.chapters)}`));
    item.append(node);
    return item;
  }));
}

function posterColors(poster) {
  const found = poster?.match(/#[0-9a-f]{6}/gi) || [];
  return found.length >= 3 ? found.slice(0, 3) : DEFAULT_COLORS;
}

function updatePreview() {
  const [c0, c1, c2] = [0, 1, 2].map((i) => titleField(`color${i}`).value);
  const poster = `linear-gradient(145deg, ${c0}, ${c1} 55%, ${c2})`;
  const cover = current?.cover || null;
  posterPreview.style.background = posterBackground({ cover, poster });
  posterPreview.textContent = cover ? "" : titleField("symbol").value.trim();
}

/** Обложку можно загрузить только у сохранённого тайтла: ключ в R2 строится по его id */
function renderCover() {
  coverField.hidden = !current;
  coverRemove.hidden = !current?.cover;
}

function replaceCurrent(saved) {
  current = { ...saved, chapters: current?.chapters ?? saved.chapters };
  titles = titles.map((title) => (title.id === current.id ? current : title));
  renderTitles();
  renderCover();
  updatePreview();
}

coverInput.addEventListener("change", async () => {
  const file = coverInput.files[0];
  coverInput.value = "";
  if (!file || !current) return;
  if (!IMAGE_TYPES.includes(file.type)) return setMessage(titleMessage, "Обложка должна быть картинкой JPEG, PNG, WebP или AVIF.");
  if (file.size > MAX_COVER_BYTES) return setMessage(titleMessage, "Обложка должна быть не больше 5 МБ.");

  setMessage(titleMessage, "Загружаю обложку…");
  let response = null;
  try {
    response = await fetch(`${titleUrl(current.id)}/cover`, {
      method: "PUT",
      body: file,
      credentials: "same-origin",
      headers: { "Content-Type": file.type }
    });
  } catch {}
  const data = response ? await response.json().catch(() => null) : null;
  if (!response?.ok) return setMessage(titleMessage, data?.error || "Не удалось загрузить обложку.");
  replaceCurrent(data.title);
  setMessage(titleMessage, "Обложка загружена.", true);
});

coverRemove.addEventListener("click", async () => {
  if (!current?.cover || !confirm("Убрать обложку? Вместо неё будет градиент с символом.")) return;
  const result = await api(`${titleUrl(current.id)}/cover`, { method: "DELETE" });
  if (!result.ok) return setMessage(titleMessage, result.data?.error || "Не удалось убрать обложку.");
  replaceCurrent(result.data.title);
  setMessage(titleMessage, "Обложка убрана.", true);
});

function fillTitleForm(title) {
  titleField("title").value = title?.title ?? "";
  titleField("type").value = title?.type ?? "manhwa";
  titleField("status").value = title?.status ?? "ongoing";
  titleField("year").value = String(title?.year ?? new Date().getFullYear());
  titleField("rating").value = String(title?.rating ?? 8);
  titleField("genres").value = title?.genres.join(", ") ?? "";
  titleField("author").value = title?.author ?? "";
  titleField("translator").value = title?.translator ?? "";
  titleField("symbol").value = title?.symbol ?? "✦";
  posterColors(title?.poster).forEach((color, i) => (titleField(`color${i}`).value = color.toLowerCase()));
  titleField("description").value = title?.description ?? "";
  updatePreview();

  titleHeading.textContent = title ? title.title : "Новый тайтл";
  deleteTitleButton.hidden = !title;
  viewTitleLink.hidden = !title;
  if (title) viewTitleLink.href = `/title/${title.id}`;
}

async function selectTitle(id) {
  if (busy()) return;
  current = titles.find((title) => title.id === id) || null;
  history.replaceState(null, "", current ? `#${current.id}` : location.pathname);
  fillTitleForm(current);
  renderCover();
  renderTitles();
  setMessage(titleMessage, "");
  setMessage(chapterMessage, "");
  chaptersSection.hidden = !current;
  resetChapterForm();
  if (current) await loadChapters();
}

titleForm.addEventListener("input", (event) => {
  if (event.target.name === "symbol" || event.target.type === "color") updatePreview();
});

titleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    title: titleField("title").value,
    type: titleField("type").value,
    status: titleField("status").value,
    year: Number(titleField("year").value),
    rating: Number(titleField("rating").value.replace(",", ".")),
    genres: titleField("genres").value.split(","),
    author: titleField("author").value,
    translator: titleField("translator").value,
    symbol: titleField("symbol").value,
    colors: [0, 1, 2].map((i) => titleField(`color${i}`).value),
    description: titleField("description").value
  };
  const isNew = !current;
  const result = isNew
    ? await api("/api/admin/titles", { method: "POST", body })
    : await api(titleUrl(current.id), { method: "PUT", body });
  if (!result.ok) return setMessage(titleMessage, result.data?.error || "Не удалось сохранить тайтл.");

  const saved = result.data.title;
  titles = isNew ? [...titles, saved] : titles.map((title) => (title.id === saved.id ? saved : title));
  await selectTitle(saved.id);
  setMessage(titleMessage, isNew ? "Тайтл создан. Теперь добавьте главы." : "Тайтл сохранён.", true);
});

deleteTitleButton.addEventListener("click", async () => {
  if (!current || busy()) return;
  if (!confirm(`Удалить «${current.title}» вместе со всеми главами, страницами и отметками читателей? Это нельзя отменить.`)) return;
  const result = await api(titleUrl(current.id), { method: "DELETE" });
  if (!result.ok) return setMessage(titleMessage, result.data?.error || "Не удалось удалить тайтл.");
  const removed = current.title;
  titles = titles.filter((title) => title.id !== current.id);
  await selectTitle(null);
  setMessage(titleMessage, `Тайтл «${removed}» удалён.`, true);
});

$("#newTitleButton").addEventListener("click", async () => {
  await selectTitle(null);
  titleField("title").focus();
});

// ==================== ГЛАВЫ ====================

async function loadChapters() {
  const result = await api(`${titleUrl(current.id)}/chapters`);
  if (!result.ok) {
    chapters = [];
    setMessage(chapterMessage, result.data?.error || "Не удалось загрузить главы.");
  } else {
    chapters = result.data.chapters;
  }
  // Число глав в списке тайтлов слева
  current = { ...current, chapters: chapters.length ? chapters[0].number : 0 };
  titles = titles.map((title) => (title.id === current.id ? current : title));
  renderTitles();
  renderChapters();
}

function renderChapters() {
  if (!chapters.length) {
    chapterList.replaceChildren(element("li", "admin-empty", "Глав пока нет. Добавьте первую главу формой выше."));
    return;
  }
  // Главы приходят новыми сверху: первая в списке — последняя по номеру
  const last = chapters[0].number;
  chapterList.replaceChildren(...chapters.map((chapter) => chapterRow(chapter, chapter.number === last)));
}

function chapterRow(chapter, isLast) {
  const item = element("li", "admin-chapter");

  const info = element("div", "admin-chapter-info");
  const label = `${chapter.sideStory ? "Экстра · " : ""}Глава ${chapter.number}${chapter.name ? `: ${chapter.name}` : ""}`;
  const details = [
    chapter.volume ? `Том ${chapter.volume}` : "",
    formatDate(chapter.releasedAt),
    chapter.pages ? `Страниц: ${chapter.pages}` : "Страницы не загружены"
  ].filter(Boolean).join(" · ");
  info.append(element("strong", null, label), element("small", chapter.pages ? null : "admin-warning", details));

  const actions = element("div", "admin-chapter-actions");
  const upload = element("label", "secondary-button admin-upload", chapter.pages ? "Заменить страницы" : "Загрузить страницы");
  const input = element("input", "visually-hidden");
  input.type = "file";
  input.multiple = true;
  input.accept = IMAGE_TYPES.join(",");
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.value = "";
    if (files.length) uploadPages(chapter, item, files);
  });
  upload.append(input);

  actions.append(button("Изменить", "secondary-button", () => editChapter(chapter)), upload);
  if (chapter.pages) {
    const link = element("a", "secondary-button", "Читать");
    link.href = `/read/${current.id}/${chapter.number}`;
    link.target = "_blank";
    link.rel = "noopener";
    actions.append(link, button("Убрать страницы", "secondary-button", () => removePages(chapter)));
  }
  if (isLast) actions.append(button("Удалить главу", "danger-button", () => deleteChapter(chapter)));

  const progress = element("p", "admin-progress");
  progress.setAttribute("role", "status");
  progress.hidden = true;

  item.append(info, actions, progress);
  return item;
}

function resetChapterForm() {
  editing = null;
  chapterForm.reset();
  chapterHeading.textContent = "Новая глава";
  chapterForm.querySelector("[type=submit]").textContent = "Добавить главу";
  chapterCancel.hidden = true;
}

function editChapter(chapter) {
  if (busy()) return;
  editing = chapter.number;
  chapterField("name").value = chapter.name ?? "";
  chapterField("volume").value = chapter.volume ? String(chapter.volume) : "";
  chapterField("releasedAt").value = chapter.releasedAt.slice(0, 10);
  chapterField("sideStory").checked = chapter.sideStory;
  chapterHeading.textContent = `Глава ${chapter.number}`;
  chapterForm.querySelector("[type=submit]").textContent = "Сохранить главу";
  chapterCancel.hidden = false;
  chapterForm.scrollIntoView({ behavior: "smooth", block: "center" });
  chapterField("name").focus({ preventScroll: true });
}

chapterCancel.addEventListener("click", resetChapterForm);

chapterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy()) return;
  const volume = chapterField("volume").value.trim();
  const body = {
    name: chapterField("name").value,
    volume: volume ? Number(volume) : null,
    releasedAt: chapterField("releasedAt").value || null,
    sideStory: chapterField("sideStory").checked
  };
  const isNew = editing === null;
  const result = isNew
    ? await api(`${titleUrl(current.id)}/chapters`, { method: "POST", body })
    : await api(chapterUrl(editing), { method: "PUT", body });
  if (!result.ok) return setMessage(chapterMessage, result.data?.error || "Не удалось сохранить главу.");

  const { number } = result.data.chapter;
  resetChapterForm();
  await loadChapters();
  setMessage(chapterMessage, isNew ? `Глава ${number} добавлена. Загрузите её страницы.` : `Глава ${number} сохранена.`, true);
});

async function deleteChapter(chapter) {
  if (busy()) return;
  if (!confirm(`Удалить главу ${chapter.number} вместе со страницами? Это нельзя отменить.`)) return;
  const result = await api(chapterUrl(chapter.number), { method: "DELETE" });
  if (!result.ok) return setMessage(chapterMessage, result.data?.error || "Не удалось удалить главу.");
  if (editing === chapter.number) resetChapterForm();
  await loadChapters();
  setMessage(chapterMessage, `Глава ${chapter.number} удалена.`, true);
}

async function removePages(chapter) {
  if (busy()) return;
  if (!confirm(`Убрать загруженные страницы главы ${chapter.number}? Файлы будут удалены.`)) return;
  const result = await api(`${chapterUrl(chapter.number)}/pages`, { method: "DELETE" });
  if (!result.ok) return setMessage(chapterMessage, result.data?.error || "Не удалось убрать страницы.");
  await loadChapters();
  setMessage(chapterMessage, `Страницы главы ${chapter.number} убраны.`, true);
}

// ==================== ЗАГРУЗКА СТРАНИЦ ====================

/** Размер первой страницы: по нему читалка задаёт width/height у картинок */
async function imageSize(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    // Браузер не умеет читать этот формат: читалка возьмёт стандартный размер
    return null;
  }
}

async function putPage(chapterNumber, page, file) {
  const url = `${chapterUrl(chapterNumber)}/pages/${page}`;
  let response = null;
  // Одна повторная попытка: на мобильном интернете запрос иногда обрывается
  for (let attempt = 1; attempt <= 2 && !response; attempt++) {
    try {
      response = await fetch(url, { method: "PUT", body: file, credentials: "same-origin", headers: { "Content-Type": file.type } });
    } catch {}
  }
  if (!response) throw new Error(`Страница ${page} (${file.name}): нет связи с сервером.`);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(`Страница ${page} (${file.name}): ${data?.error || "не загрузилась."}`);
  }
}

/**
 * Страницы грузятся в черновик (следующую версию) по несколько штук сразу и публикуются одним запросом.
 * Если загрузка оборвалась, читатели продолжают видеть прежние страницы
 */
async function uploadPages(chapter, row, files) {
  if (busy()) return;
  files.sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true, sensitivity: "base" }));
  const problem = files.length > MAX_PAGES ? `В главе не больше ${MAX_PAGES} страниц.`
    : files.some((file) => !IMAGE_TYPES.includes(file.type)) ? "Подходят только картинки JPEG, PNG, WebP и AVIF."
    : files.some((file) => file.size > MAX_PAGE_BYTES) ? "Каждая страница должна быть не больше 15 МБ."
    : "";
  if (problem) return setMessage(chapterMessage, problem);
  if (chapter.pages && !confirm(`Заменить страницы главы ${chapter.number} (сейчас ${chapter.pages}) на ${files.length} новых?`)) return;

  uploading = true;
  setMessage(chapterMessage, "");
  const progress = row.querySelector(".admin-progress");
  progress.hidden = false;
  let done = 0;
  const showProgress = () => (progress.textContent = `Загружено ${done} из ${files.length}…`);
  showProgress();

  try {
    const size = await imageSize(files[0]);
    let next = 0;
    let failed = false;
    const worker = async () => {
      while (!failed && next < files.length) {
        const index = next++;
        try {
          await putPage(chapter.number, index + 1, files[index]);
        } catch (err) {
          failed = true;
          throw err;
        }
        done++;
        showProgress();
      }
    };
    const results = await Promise.allSettled(Array.from({ length: Math.min(PARALLEL_UPLOADS, files.length) }, worker));
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;

    progress.textContent = "Публикую…";
    const result = await api(`${chapterUrl(chapter.number)}/publish`, {
      method: "POST",
      body: { version: chapter.pagesVersion + 1, pages: files.length, width: size?.width ?? null, height: size?.height ?? null }
    });
    if (!result.ok) throw new Error(result.data?.error || "Не удалось опубликовать страницы.");

    uploading = false;
    await loadChapters();
    setMessage(chapterMessage, `Глава ${chapter.number}: опубликовано страниц — ${files.length}.`, true);
  } catch (err) {
    progress.hidden = true;
    setMessage(chapterMessage, `${err.message} Читатели по-прежнему видят прежние страницы.`);
  } finally {
    uploading = false;
  }
}

window.addEventListener("beforeunload", (event) => {
  if (uploading) event.preventDefault();
});

// ==================== ЖАЛОБЫ ====================

const complaintList = $("#complaintList");
const complaintsMessage = $("#complaintsMessage");
const COMPLAINT_LABELS = { new: "Новая", resolved: "Материал удалён", rejected: "Отклонена" };
let complaints = [];

function complaintRow(complaint) {
  const item = element("li", `admin-complaint${complaint.status === "new" ? " is-new" : ""}`);

  const header = element("header");
  header.append(
    element("strong", null, `№${complaint.id} · ${COMPLAINT_LABELS[complaint.status]}`),
    element("small", null, formatDate(complaint.createdAt))
  );

  // Текст жалобы пришёл от посетителя сайта: только textContent, никакого HTML
  const details = element("dl");
  const add = (label, value) => {
    const dd = element("dd");
    if (value instanceof Node) dd.append(value);
    else dd.textContent = value;
    details.append(element("dt", null, label), dd);
  };
  add("Заявитель", complaint.name);
  const mail = element("a", null, complaint.email);
  mail.href = `mailto:${encodeURIComponent(complaint.email).replace("%40", "@")}`;
  add("Почта", mail);
  add("Правообладатель", complaint.rightholder);
  add("Произведение", complaint.work);
  const links = element("div");
  for (const href of complaint.links) {
    // Сервер принимает только ссылки на этот сайт, но открываем их всё равно без доступа к этой вкладке
    const link = element("a", null, href);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    links.append(link, element("br"));
  }
  add("Ссылки", links);

  const actions = element("div", "admin-chapter-actions");
  for (const [status, label] of Object.entries(COMPLAINT_LABELS)) {
    if (status === complaint.status) continue;
    const text = status === "new" ? "Вернуть в новые" : label;
    actions.append(button(text, "secondary-button", () => setComplaintStatus(complaint, status)));
  }
  actions.append(button("Удалить жалобу", "danger-button", () => deleteComplaint(complaint)));

  item.append(header, details, element("p", "admin-complaint-text", complaint.description), actions);
  return item;
}

function renderComplaints() {
  const fresh = complaints.filter((complaint) => complaint.status === "new").length;
  $("#complaintsHeading").textContent = fresh ? `Жалобы правообладателей (новых: ${fresh})` : "Жалобы правообладателей";
  complaintList.replaceChildren(
    ...(complaints.length ? complaints.map(complaintRow) : [element("li", "admin-empty", "Жалоб нет.")])
  );
}

async function loadComplaints() {
  const result = await api("/api/admin/complaints");
  if (!result.ok) return setMessage(complaintsMessage, result.data?.error || "Не удалось загрузить жалобы.");
  complaints = result.data.complaints;
  renderComplaints();
}

async function setComplaintStatus(complaint, status) {
  const result = await api(`/api/admin/complaints/${complaint.id}`, { method: "PUT", body: { status } });
  if (!result.ok) return setMessage(complaintsMessage, result.data?.error || "Не удалось изменить жалобу.");
  setMessage(complaintsMessage, `Жалоба №${complaint.id}: ${COMPLAINT_LABELS[status].toLowerCase()}.`, true);
  await loadComplaints();
}

async function deleteComplaint(complaint) {
  if (!confirm(`Удалить жалобу №${complaint.id} с данными заявителя? Это нельзя отменить.`)) return;
  const result = await api(`/api/admin/complaints/${complaint.id}`, { method: "DELETE" });
  if (!result.ok) return setMessage(complaintsMessage, result.data?.error || "Не удалось удалить жалобу.");
  setMessage(complaintsMessage, `Жалоба №${complaint.id} удалена.`, true);
  await loadComplaints();
}

// ==================== СТАРТ ====================

async function init() {
  const { user } = await getMe();
  if (!user) {
    location.replace(loginUrl());
    return;
  }
  if (!user.isAdmin) {
    denied.hidden = false;
    return;
  }

  const result = await api("/api/admin/titles");
  if (!result.ok) {
    denied.textContent = result.data?.error || "Не удалось загрузить тайтлы.";
    denied.hidden = false;
    return;
  }
  titles = result.data.titles;
  adminLayout.hidden = false;
  loadComplaints();

  // Адрес /admin#5 открывает тайтл 5: после обновления страницы остаёшься на том же тайтле
  const fromHash = Number(location.hash.slice(1));
  await selectTitle(titles.some((title) => title.id === fromHash) ? fromHash : null);
}

init();
