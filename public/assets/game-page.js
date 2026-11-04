// Страница игры: шапка сайта, просмотр скриншотов (lightbox), подсветка раздела в навигации по странице
// и мягкое появление секций. Вся разметка собрана на сервере (functions/studio.js), без скрипта страница работает целиком

import { initHeader } from "./app.js";

initHeader();

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ==================== LIGHTBOX ====================

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
