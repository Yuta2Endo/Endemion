// Переключатель языка в шапке: cookie `lang` на год, страницу собирает сервер заново
const button = document.querySelector("[data-lang-toggle]");
button?.addEventListener("click", () => {
  const next = document.documentElement.lang === "en" ? "ru" : "en";
  document.cookie = `lang=${next}; path=/; max-age=31536000; samesite=lax`;
  location.reload();
});
