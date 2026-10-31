// Выполняется синхронно сразу после <body>, до отрисовки страниц: применяет сохранённые настройки,
// чтобы читалка не мелькала режимом по умолчанию. Встроенные скрипты запрещены CSP, поэтому это отдельный файл.
// Список OPTIONS держать в синхроне с reader.js

(() => {
  const body = document.body;
  const OPTIONS = {
    mode: ["paged", "strip"],
    direction: ["rtl", "ltr"],
    fit: ["height", "width"],
    width: ["narrow", "normal", "wide"],
    background: ["dark", "black", "light"]
  };

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  }

  const stored = read(`endemion:reader:${body.dataset.kind}`);
  if (stored && typeof stored === "object") {
    for (const [name, values] of Object.entries(OPTIONS)) {
      if (values.includes(stored[name])) body.dataset[name] = stored[name];
    }
  }

  // Цвет панели браузера под фон читалки, как THEME_COLORS в reader.js
  const THEME_COLORS = { dark: "#05070f", black: "#000000", light: "#e7e8ee" };
  const color = THEME_COLORS[body.dataset.background];
  if (color) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);

  // Если читатель вернётся не на первую страницу, страницы скрыты, пока reader.js не перейдёт на нужную
  const total = Number(body.dataset.pages);
  const isLater = (n) => Number.isInteger(n) && n > 1 && n <= total;
  const fromHash = Number(location.hash.slice(1));
  const saved = Number(read(`endemion:position:${body.dataset.titleId}:${body.dataset.chapter}`));
  if (isLater(fromHash) || isLater(saved)) body.classList.add("reader-pending");
})();
