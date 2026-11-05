// Загрузка аватара на странице аккаунта: файл уходит телом запроса, токен CSRF — в заголовке

const copyId = document.getElementById("copyId");
if (copyId) {
  copyId.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(copyId.dataset.copy || "");
      copyId.textContent = "Скопировано";
    } catch {
      copyId.textContent = "Не скопировалось";
    }
  });
}

const form = document.getElementById("avatarForm");
const input = document.getElementById("avatarFile");
const message = document.getElementById("avatarMessage");

if (form && input && message) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = input.files[0];
    message.className = "form-message";
    if (!file) {
      message.textContent = "Выберите файл.";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      message.textContent = "Файл больше 2 МБ.";
      return;
    }
    const preview = document.getElementById("avatarPreview");
    if (preview) {
      const reader = new FileReader();
      reader.onload = () => { preview.src = reader.result; preview.hidden = false; };
      reader.readAsDataURL(file);
    }
    message.textContent = "Загружаю…";
    try {
      const response = await fetch("/account/avatar", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-CSRF-Token": form.dataset.csrf },
        body: file
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не получилось загрузить аватар.");
      window.location.assign("/account?done=avatar");
    } catch (err) {
      message.textContent = err.message;
    }
  });
}
