// Кнопка «Попробовать снова» на странице без сети: стучимся в сеть и перезагружаем адрес.
// Своего обработчика в HTML нет, потому что CSP запрещает инлайновые скрипты.
const button = document.getElementById("retryButton");

if (button) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Проверяем связь…";
    try {
      await fetch("/manifest.webmanifest", { cache: "no-store" });
      location.reload();
    } catch {
      button.disabled = false;
      button.textContent = "Сети всё ещё нет";
    }
  });
}
