// POST /api/complaints — жалоба правообладателя с формы /copyright. Принимается без входа в профиль

import { parseComplaint } from "../../_lib/complaints.js";
import { clientIp, error, json, readJson } from "../../_lib/http.js";
import { isComplaintLimited, recordComplaint, RETRY_AFTER_SECONDS } from "../../_lib/rateLimit.js";
import { verifyTurnstile } from "../../_lib/turnstile.js";

export async function onRequestPost({ request, env }) {
  // Описание до 5000 символов и до 20 ссылок: обычного предела в 10 000 байт не хватит
  const body = await readJson(request, 40_000);
  if (!body) return error("Некорректный запрос.");

  const ip = clientIp(request);
  if (await isComplaintLimited(env, ip)) {
    return error("Слишком много жалоб подряд. Попробуйте через 15 минут.", 429, { "Retry-After": String(RETRY_AFTER_SECONDS) });
  }

  const { complaint, problem } = parseComplaint(body, new URL(request.url).hostname);
  if (problem) return error(problem);
  if (!(await verifyTurnstile(env, body.turnstileToken, ip))) return error("Подтвердите, что вы не робот.", 403);

  // Считаются только принятые жалобы: ошибка в форме не должна отнимать попытку
  await recordComplaint(env, ip);
  const row = await env.DB.prepare(
    "INSERT INTO complaints (name, email, rightholder, work, links, description) VALUES (?, ?, ?, ?, ?, ?) RETURNING id"
  ).bind(complaint.name, complaint.email, complaint.rightholder, complaint.work, JSON.stringify(complaint.links), complaint.description).first();

  return json({ id: row.id }, 201);
}
