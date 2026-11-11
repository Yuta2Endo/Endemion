// POST /api/robokassa/create — создание pending-заказа и формирование ссылки на оплату Robokassa.
// Только для авторизованного пользователя (endemion_sub берётся из серверной сессии).

import { error, json, readJson } from "../../_lib/http.js";
import { buildPaymentUrl, getProduct } from "../../_lib/robokassa.js";
import { currentUser } from "../../_lib/session.js";

export async function onRequestPost({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return error("Войдите в аккаунт.", 401);
  if (!user.endemionSub) {
    return error("Для оплаты требуется аккаунт Endemion ID.", 403);
  }

  const body = await readJson(request);
  if (!body || typeof body.itemId !== "string") return error("Некорректный запрос.");

  const product = getProduct(body.itemId.trim());
  if (!product) return error("Неизвестный товар.", 400);

  const login = String(env.ROBOKASSA_MERCHANT_LOGIN || "").trim();
  const pass1 = String(env.ROBOKASSA_PASSWORD_1 || "").trim();
  if (!login || !pass1) {
    return error("Оплата временно недоступна.", 503);
  }

  const row = await env.DB.prepare(
    `INSERT INTO orders (endemion_sub, user_id, item_id, amount, crystals, status)
     VALUES (?, ?, ?, ?, ?, 'pending')
     RETURNING inv_id`
  ).bind(user.endemionSub, user.id, product.itemId, product.amount, product.crystals).first();

  if (!row || !row.inv_id) return error("Не удалось создать заказ.", 500);

  const invId = Number(row.inv_id);
  const shp = { Shp_uid: user.endemionSub, Shp_item: product.itemId };
  const url = buildPaymentUrl(env, {
    invId,
    outSum: product.amount,
    description: product.title,
    shp
  });

  return json({
    invId,
    itemId: product.itemId,
    amount: product.amount,
    crystals: product.crystals,
    url
  }, 201);
}