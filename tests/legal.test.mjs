// Legal Center: документы игр на двух языках, оглавление, навигация, 404, подвал, карта сайта

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { LEGAL_GAMES } from "../functions/_lib/legal/index.js";
import { legalPaths } from "../functions/legal.js";
import { createApp } from "./helpers/app.mjs";

let app;

before(async () => {
  app = await createApp();
});

after(async () => {
  await app.close();
});

const SLUGS = ["tetrus", "little-weather", "liforae", "endemion-life"];
const DOCS = ["privacy-policy", "terms-of-service"];

const PRIVACY_SECTIONS = ["information-collected", "automatic", "device", "advertising", "analytics", "third-party", "usage", "sharing",
  "retention", "security", "children", "rights", "deletion", "gdpr", "california", "transfers", "contact", "changes"];
const TERMS_SECTIONS = ["acceptance", "eligibility", "license", "accounts", "user-content", "online", "prohibited", "virtual-items",
  "purchases", "refunds", "intellectual-property", "availability", "updates", "termination", "disclaimers", "liability", "governing-law",
  "changes", "contact"];

test("в Legal Center ровно четыре игры, без OS Developer Simulator", () => {
  assert.deepEqual(LEGAL_GAMES.map((g) => g.slug), SLUGS);
});

test("каждый документ открывается на русском и английском с верным lang, canonical и hreflang", async () => {
  const guest = app.client();
  for (const slug of SLUGS) {
    for (const doc of DOCS) {
      const path = `/legal/${slug}/${doc}`;
      for (const lang of ["ru", "en"]) {
        const url = lang === "en" ? `${path}?lang=en` : path;
        const r = await guest.call("GET", url);
        assert.equal(r.status, 200, url);
        assert.match(r.text, new RegExp(`<html lang="${lang}">`), url);
        assert.match(r.text, new RegExp(`<link rel="canonical" href="[^"]*${url.replace("?", "\\?")}">`), url);
        assert.match(r.text, new RegExp(`hreflang="ru" href="[^"]*${path}"`), url);
        assert.match(r.text, new RegExp(`hreflang="en" href="[^"]*${path}\\?lang=en"`), url);
        assert.doesNotMatch(r.text, /name="robots" content="noindex/, url);
        assert.equal((r.text.match(/<h1[ >]/g) || []).length, 1, `${url}: один h1`);
        assert.match(r.text, /<time datetime="\d{4}-\d{2}-\d{2}">/, `${url}: дата обновления`);
      }
    }
  }
});

test("в документах есть все обязательные разделы, оглавление ведёт на существующие якоря", async () => {
  const guest = app.client();
  for (const slug of SLUGS) {
    for (const doc of DOCS) {
      for (const query of ["", "?lang=en"]) {
        const url = `/legal/${slug}/${doc}${query}`;
        const { text } = await guest.call("GET", url);
        const ids = [...text.matchAll(/<section id="([^"]+)">/g)].map((m) => m[1]);
        for (const id of doc === "privacy-policy" ? PRIVACY_SECTIONS : TERMS_SECTIONS) assert.ok(ids.includes(id), `${url}: раздел ${id}`);
        assert.equal(new Set(ids).size, ids.length, `${url}: якоря не повторяются`);
        const toc = text.slice(text.indexOf('class="legal-toc"'), text.indexOf('class="legal-doc"'));
        const links = [...toc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
        assert.deepEqual(links, ids, `${url}: оглавление совпадает с разделами`);
      }
    }
  }
});

test("навигация: вкладки между документами, переключатель языка, ссылка на Legal Center", async () => {
  const guest = app.client();
  const { text } = await guest.call("GET", "/legal/tetrus/terms-of-service?lang=en");
  assert.match(text, /<a href="\/legal\/tetrus\/privacy-policy\?lang=en">Privacy Policy<\/a>/);
  assert.match(text, /<a href="\/legal\/tetrus\/terms-of-service\?lang=en" aria-current="page">Terms of Service<\/a>/);
  assert.match(text, /href="\/legal\/tetrus\/terms-of-service" hreflang="ru" lang="ru">Русский<\/a>/);
  assert.match(text, /href="\/legal\/tetrus\/terms-of-service\?lang=en" hreflang="en" lang="en" aria-current="true">English<\/a>/);
  assert.match(text, /class="legal-breadcrumbs"[^>]*><a href="\/legal\?lang=en">Legal Center<\/a>/);
  assert.match(text, /<div class="eyebrow">TETRUS<\/div>/);
});

test("главная Legal Center ссылается на оба документа каждой игры и на документы сайта", async () => {
  const guest = app.client();
  for (const query of ["", "?lang=en"]) {
    const r = await guest.call("GET", `/legal${query}`);
    assert.equal(r.status, 200);
    for (const slug of SLUGS) {
      for (const doc of DOCS) assert.match(r.text, new RegExp(`href="/legal/${slug}/${doc}${query.replace("?", "\\?")}"`), `${slug} ${doc}`);
    }
    assert.match(r.text, /href="\/privacy"/);
    assert.match(r.text, /href="\/terms"/);
    assert.doesNotMatch(r.text, /os-developer-simulator|OS Developer Simulator/);
  }
});

test("неизвестные игра и документ — 404 с noindex, адрес игры ведёт на её политику", async () => {
  const guest = app.client();
  for (const path of ["/legal/os-developer-simulator", "/legal/os-developer-simulator/privacy-policy", "/legal/tetrus/eula",
    "/legal/tetrus/constructor", "/legal/__proto__/privacy-policy", "/legal/tetrus/privacy-policy/extra"]) {
    const r = await guest.call("GET", path);
    assert.equal(r.status, 404, path);
    if (r.text.startsWith("<!doctype")) assert.match(r.text, /<meta name="robots" content="noindex/, path);
  }
  const redirect = await guest.call("GET", "/legal/liforae?lang=en");
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "/legal/liforae/privacy-policy?lang=en");
  // Адрес со слешем в конце открывает ту же страницу
  assert.equal((await guest.call("GET", "/legal/liforae/privacy-policy/")).status, 200);
  // Любое значение lang, кроме en, — русская версия
  assert.match((await guest.call("GET", "/legal?lang=de")).text, /<html lang="ru">/);
});

test("заполнители видны и помечены, документы с ними отмечены как черновик", async () => {
  const guest = app.client();
  const { text } = await guest.call("GET", "/legal/endemion-life/privacy-policy?lang=en");
  assert.match(text, /<mark class="legal-placeholder">\[contact email\]<\/mark>/);
  assert.match(text, /<p class="legal-draft" role="note">Draft\./);
  assert.doesNotMatch(text, /\[\[|\{\{/, "необработанная разметка не попадает на страницу");
});

test("страницы Legal Center публичные, с заголовками безопасности и без встроенных скриптов", async () => {
  const guest = app.client();
  const r = await guest.call("GET", "/legal/little-weather/privacy-policy");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.doesNotMatch(r.text, /<script(?![^>]*\b(src|type="application\/ld\+json")=?)[^>]*>/);
  assert.doesNotMatch(r.text, /style="/);
});

test("в подвале сайта есть ссылка на Legal Center, правовые страницы сайта на месте", async () => {
  const guest = app.client();
  const home = await guest.call("GET", "/");
  assert.match(home.text, /<a href="\/legal">Правовой центр<\/a>/);
  assert.match(home.text, /<a href="\/privacy">/);
  assert.match(home.text, /<a href="\/terms">/);
  assert.equal((await guest.call("GET", "/terms")).status, 200);
});

test("карта сайта содержит все адреса Legal Center на обоих языках", async () => {
  const guest = app.client();
  const { text } = await guest.call("GET", "/sitemap.xml");
  assert.equal(legalPaths().length, 18);
  for (const path of legalPaths()) assert.ok(text.includes(`${path.replace("?", "?")}</loc>`), path);
  const robots = await guest.call("GET", "/robots.txt");
  assert.doesNotMatch(robots.text, /Disallow: \/legal/);
});
