// Реклама Яндекс.РСЯ (Яндекс.Автоплейсмент). Страница отдаёт номер кампании (page-id) и место для блока,
// блок рисует public/assets/ads.js — так позиция рекламы задаётся сайтом, а не алгоритмом Яндекса.
// Без номера кампании в настройках окружения рекламы на сайте нет.

import { escapeHtml as e } from "./html.js";

// Номер кампании в Яндекс.Директе: только цифры, иначе реклама выключена
const PAGE_ID = /^\d{1,12}$/;

/** Номер кампании из настроек окружения. Пустая строка — реклама выключена */
export function adsPageId(env) {
  const value = String(env?.YANDEX_ADS_PAGE_ID || "").trim();
  return PAGE_ID.test(value) ? value : "";
}

/**
 * Место для рекламного блока. Разметка одинакова для всех страниц: скрипт находит слот по data-ads-slot
 * и рисует в нём блок кампании. Если реклама не настроена или не показалась, место скрывается.
 */
export function adsBlock(env, { id = "yandex-ads-slot", label = "Реклама" } = {}) {
  const pageId = adsPageId(env);
  if (!pageId) return "";
  return `<section class="ads-block" aria-label="${e(label)}">
    <span class="ads-caption">${e(label)}</span>
    <div class="ads-slot" id="${e(id)}" data-ads-slot data-ads-page-id="${e(pageId)}"></div>
  </section>`;
}
