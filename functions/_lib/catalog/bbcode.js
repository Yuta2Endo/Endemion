// Описания из источника размечены BBCode: [character=123]Имя[/character], [spoiler]…[/spoiler], [b]…[/b].
// Текст сначала экранируется целиком, затем известные теги превращаются в свою разметку, остальные удаляются.
// Ссылки ведут только на страницы Endemion: в адрес попадают одни цифры

import { escapeHtml } from "../html.js";

const LINKS = { anime: "/anime/", manga: "/manga/", ranobe: "/manga/", character: "/characters/", person: "/people/" };
const STYLES = { b: "strong", i: "em", u: "u", s: "s" };
const LINK_TAG = /\[(anime|manga|ranobe|character|person)=(\d{1,9})[^\]]*\]([\s\S]*?)\[\/\1\]/g;
const SPOILER = /\[spoiler(?:=([^\]]{0,80}))?\]((?:(?!\[spoiler)[\s\S])*?)\[\/spoiler\]/g;
const ANY_TAG = /\[\/?[a-z_]+(?:=[^\]]*)?\]/g;

/** Описание как безопасный HTML: абзацы, ссылки на персонажей и произведения, раскрывающиеся спойлеры */
export function bbcodeToHtml(source) {
  if (!source) return "";
  let text = escapeHtml(String(source).replace(/\r\n?/g, "\n"))
    .replace(/\[source\][\s\S]*?\[\/source\]/g, "")
    .replace(/\[url(?:=[^\]]*)?\]([\s\S]*?)\[\/url\]/g, "$1")
    .replace(/\[\[([^\]]{1,120})\]\]/g, "$1")
    .replace(LINK_TAG, (_, tag, id, label) => `<a href="${LINKS[tag]}${id}">${label}</a>`)
    .replace(/\[(b|i|u|s)\]([\s\S]*?)\[\/\1\]/g, (_, tag, inner) => `<${STYLES[tag]}>${inner}</${STYLES[tag]}>`);
  // Вложенные спойлеры раскрываются изнутри наружу
  for (let i = 0; i < 5 && SPOILER.test(text); i++) {
    SPOILER.lastIndex = 0;
    text = text.replace(SPOILER, (_, label, inner) =>
      `<details class="bb-spoiler"><summary>${label ? label.trim() : "Спойлер"}</summary>${inner.trim()}</details>`);
  }
  text = text.replace(ANY_TAG, "").trim();
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Описание обычным текстом для карточек и meta description: без тегов и без спойлеров */
export function bbcodeToText(source, max = 300) {
  if (!source) return "";
  const text = String(source)
    .replace(/\[spoiler(?:=[^\]]*)?\][\s\S]*?\[\/spoiler\]/g, "")
    .replace(/\[source\][\s\S]*?\[\/source\]/g, "")
    .replace(/\[\[([^\]]{1,120})\]\]/g, "$1")
    .replace(ANY_TAG, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max * 0.6 ? cut.lastIndexOf(" ") : max).replace(/[,.;:—-]+$/, "")}…`;
}
