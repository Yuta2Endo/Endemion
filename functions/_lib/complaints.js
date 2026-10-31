// Жалобы правообладателей: проверка формы и вид записи для админки

import { normalizeEmail, validateEmail } from "./validate.js";

export const COMPLAINT_STATUSES = ["new", "resolved", "rejected"];
export const COMPLAINT_COLUMNS = "id, name, email, rightholder, work, links, description, status, created_at, updated_at";
const MAX_LINKS = 20;
const MAX_LINK_LENGTH = 500;

/** Однострочный текст: без управляющих символов и лишних пробелов */
function line(value) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
}

/** Многострочный текст: переносы строк остаются, остальные управляющие символы убираются */
function text(value) {
  return typeof value === "string"
    ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim()
    : "";
}

/**
 * Жалоба из формы. hostname — домен сайта: ссылки должны вести на страницы Endemion,
 * иначе форма стала бы способом присылать администратору чужие ссылки
 */
export function parseComplaint(body, hostname) {
  const name = line(body.name);
  if (name.length < 2 || name.length > 200) return { problem: "Укажите имя или название заявителя: от 2 до 200 символов." };

  const email = normalizeEmail(body.email);
  const emailProblem = validateEmail(email);
  if (emailProblem) return { problem: emailProblem };

  const rightholder = line(body.rightholder);
  if (rightholder.length < 2 || rightholder.length > 200) return { problem: "Укажите правообладателя: от 2 до 200 символов." };

  const work = line(body.work);
  if (!work || work.length > 300) return { problem: "Укажите произведение: от 1 до 300 символов." };

  const raw = typeof body.links === "string" ? body.links.split(/\s+/).filter(Boolean) : [];
  if (!raw.length) return { problem: "Укажите хотя бы одну ссылку на страницу Endemion." };
  if (raw.length > MAX_LINKS) return { problem: `Не больше ${MAX_LINKS} ссылок в одной жалобе.` };
  const links = [];
  for (const value of raw) {
    let url = null;
    try {
      url = new URL(value);
    } catch {}
    if (!url || !["http:", "https:"].includes(url.protocol) || url.hostname !== hostname || value.length > MAX_LINK_LENGTH) {
      return { problem: `Ссылка должна вести на страницу Endemion: ${value.slice(0, 80)}` };
    }
    links.push(url.href);
  }

  const description = text(body.description);
  if (description.length < 20 || description.length > 5000) return { problem: "Опишите, на чём основаны права: от 20 до 5000 символов." };

  if (body.statement !== true) return { problem: "Подтвердите достоверность сведений." };

  return { complaint: { name, email, rightholder, work, links: [...new Set(links)], description } };
}

export function toComplaint(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    rightholder: row.rightholder,
    work: row.work,
    links: JSON.parse(row.links),
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
