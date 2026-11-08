// Страница игры: шапка сайта, просмотр скриншотов (lightbox), подсветка раздела в навигации по странице
// и мягкое появление секций. Вся разметка собрана на сервере (functions/studio.js), без скрипта страница работает целиком

import { api, getMe, initHeader } from "./app.js";

initHeader();

let myUsername = null;
getMe().then(({ user }) => { if (user) myUsername = user.username; });

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ==================== ЛИБОТЕКА / ИЗБРАННЫЕ ====================

async function toggleFavorite(button) {
  if (!myUsername) return;
  const gameId = button.dataset.gameId;
  const favorited = button.dataset.favorited === "1";
  const isAdding = !favorited;

  button.disabled = true;

  try {
    if (isAdding) {
      const result = await api(`/api/users/${encodeURIComponent(myUsername)}/library/add`, {
        method: "POST",
        body: { game_id: Number(gameId) }
      });
      if (result.ok) {
        button.dataset.favorited = "1";
        button.textContent = button.dataset.favoritedShortAdded || "В избранное";
        button.setAttribute("aria-label", button.dataset.favoritedLabelAdded || "Убрать из избранного");
      }
    } else {
      const result = await api(`/api/users/${encodeURIComponent(myUsername)}/library/${gameId}`, {
        method: "DELETE"
      });
      if (result.ok) {
        button.dataset.favorited = "0";
        button.textContent = button.dataset.favoritedShortRemoved || "В избранное";
        button.setAttribute("aria-label", button.dataset.favoritedLabelRemoved || "Добавить в избранное");
      }
    }
  } finally {
    button.disabled = false;
  }
}

function initFavoriteButtons() {
  const buttons = [...document.querySelectorAll(".game-favorite-btn")];
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => toggleFavorite(btn));
  });
}

// ==================== ОТЗЫВЫ К ИГРЕ ====================

function initReviewForm() {
  const form = document.getElementById("gameReviewForm");
  if (!form) return;

  const scoreInput = document.getElementById("reviewScore");
  const bodyTextarea = document.getElementById("reviewBody");
  const spoilerCheckbox = document.getElementById("reviewSpoiler");
  const submitBtn = document.getElementById("reviewSubmitBtn");
  const deleteBtn = document.getElementById("reviewDeleteBtn");
  const cancelBtn = document.getElementById("reviewCancelBtn");
  const messageEl = document.getElementById("reviewMessage");
  const scoreButtons = [...form.querySelectorAll(".score-btn")];
  const gameSlug = document.location.pathname.split("/").pop();

  let isEditMode = !!submitBtn.dataset.reviewId;
  let reviewId = submitBtn.dataset.reviewId || "";
  let selectedScore = parseInt(scoreInput.value) || 0;

  // Выбор оценки
  scoreButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedScore = parseInt(btn.dataset.score);
      scoreInput.value = selectedScore;
      scoreButtons.forEach((b) => {
        const active = parseInt(b.dataset.score) === selectedScore;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", active);
      });
    });
  });

  // Показать спойлер
  form.querySelectorAll(".game-review-reveal").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bodyEl = btn.closest(".game-review-body");
      bodyEl.classList.remove("spoiler-hidden");
      const textEl = bodyEl.querySelector("p, .muted");
      if (textEl) textEl.removeAttribute("aria-hidden");
      btn.setAttribute("aria-expanded", "true");
      btn.remove();
    });
  });

  async function setMessage(text, isError = true) {
    messageEl.textContent = text;
    messageEl.className = "form-error" + (isError ? "" : " is-success");
  }

  async function saveReview() {
    if (!selectedScore) {
      return setMessage("Выберите оценку от 1 до 10.");
    }
    submitBtn.disabled = true;
    try {
      const url = isEditMode
        ? `/api/games/${encodeURIComponent(gameSlug)}/reviews/${encodeURIComponent(reviewId)}`
        : `/api/games/${encodeURIComponent(gameSlug)}/reviews/add`;
      const method = isEditMode ? "PATCH" : "POST";
      const result = await api(url, {
        method,
        body: {
          score: selectedScore,
          body: bodyTextarea.value,
          spoiler: spoilerCheckbox.checked
        }
      });
      if (result.ok) {
        setMessage(isEditMode ? "Отзыв обновлён." : "Отзыв сохранён.", false);
        submitBtn.textContent = submitBtn.dataset.editText || submitBtn.textContent;
        deleteBtn.hidden = false;
        scoreInput.value = selectedScore;
        isEditMode = true;
        reviewId = result.data.id || reviewId;
        submitBtn.dataset.reviewId = reviewId;
        deleteBtn.dataset.reviewId = reviewId;
      } else {
        setMessage(result.data?.error || "Не удалось сохранить отзыв.");
      }
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function deleteReview() {
    if (!confirm("Удалить отзыв? Это нельзя отменить.")) return;
    deleteBtn.disabled = true;
    try {
      const result = await api(`/api/games/${encodeURIComponent(gameSlug)}/reviews/${encodeURIComponent(reviewId)}`, {
        method: "DELETE"
      });
      if (result.ok) {
        location.reload();
      } else {
        setMessage(result.data?.error || "Не удалось удалить отзыв.");
      }
    } finally {
      deleteBtn.disabled = false;
    }
  }

  submitBtn.addEventListener("click", saveReview);
  deleteBtn.addEventListener("click", deleteReview);
  cancelBtn.addEventListener("click", () => {
    location.reload();
  });
}

initLightbox();
initSubnav();
initReveal();
initFavoriteButtons();
initReviewForm();

function initLightbox() {
  const gallery = document.querySelector("[data-lightbox]");
  const dialog = document.querySelector(".gp-lightbox");
  if (!gallery || !dialog || typeof dialog.showModal !== "function") return;
  const items = [...gallery.querySelectorAll("[data-lightbox-item]")];
  const img = dialog.querySelector("img");
  const caption = dialog.querySelector("figcaption");
  let index = 0;
  let opener = null;

  const show = (i) => {
    index = (i + items.length) % items.length;
    const item = items[index];
    img.src = item.getAttribute("href");
    img.alt = item.dataset.caption || `Скриншот ${index + 1} из ${items.length}`;
    caption.textContent = item.dataset.caption
      ? `${item.dataset.caption} · ${index + 1} / ${items.length}` : `${index + 1} / ${items.length}`;
  };

  if (items.length < 2) dialog.dataset.single = "";
  items.forEach((item, i) => item.addEventListener("click", (event) => {
    event.preventDefault();
    opener = item;
    show(i);
    dialog.showModal();
  }));
  dialog.querySelector(".gp-lb-prev").addEventListener("click", () => show(index - 1));
  dialog.querySelector(".gp-lb-next").addEventListener("click", () => show(index + 1));
  dialog.querySelector(".gp-lb-close").addEventListener("click", () => dialog.close());
  // Клик по фону вокруг картинки закрывает просмотр
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") show(index - 1);
    if (event.key === "ArrowRight") show(index + 1);
  });
  dialog.addEventListener("close", () => {
    img.removeAttribute("src");
    opener?.focus();
  });
}

// ==================== НАВИГАЦИЯ ПО СТРАНИЦЕ ====================

function initSubnav() {
  const links = [...document.querySelectorAll(".gp-subnav a[href^='#']")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      links.forEach((a) => a.removeAttribute("aria-current"));
      const active = byId.get(entry.target.id);
      if (active) {
        active.setAttribute("aria-current", "true");
        active.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  byId.forEach((_, id) => {
    const target = document.getElementById(id);
    if (target) observer.observe(target);
  });
}

// ==================== ПОЯВЛЕНИЕ СЕКЦИЙ ====================

function initReveal() {
  if (reduceMotion || !("IntersectionObserver" in window)) return;
  const targets = document.querySelectorAll(".gp-section");
  // Секция, уже видимая при загрузке, не прячется: иначе она мигнёт
  const vh = window.innerHeight;
  const hidden = [...targets].filter((el) => el.getBoundingClientRect().top > vh);
  if (!hidden.length) return;
  document.documentElement.classList.add("gp-js");
  hidden.forEach((el) => el.classList.add("gp-reveal"));
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -10% 0px" });
  hidden.forEach((el) => observer.observe(el));
}

initLightbox();
initSubnav();
initReveal();
initFavoriteButtons();
