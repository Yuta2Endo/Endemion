// POST/GET /api/robokassa/result — серверное уведомление Robokassa об оплате (Result URL).
// Начисление валюты делается ТОЛЬКО здесь. Ответ при успехе: "OK<InvId>".

import { timingSafeEqual } from "node:crypto";
import { getProduct, resultSignature } from "../../_lib/robokassa.js";

function parseParams(request, bodyText) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  for (const [k, v] of url.searchParams.entries()) params.append(k, v);
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (bodyText) {
    if (ct.includes("application/x-www-form-urlencoded") || ct.includes("text/plain") || ct === "") {
      for (const [k, v] of new URLSearchParams(bodyText).entries()) params.append(k, v);
    }
  }
  return params;
}

function get(params, name) {
  const v = params.get(name);
  return v == null ? "" : String(v);
}

function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a.toLowerCase(), "utf8");
  const bb = Buffer.from(b.toLowerCase(), "utf8");
  if (aa.length !== bb.length || aa.length === 0) return false;
  try {
    return timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

function plain(text, status = 200) {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function normalizeOutSum(value) {
  // Robokassa может прислать "100.000000" или "100"; сравниваем численно с ожидаемой суммой заказа.
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

export async function onRequestPost(context) {
  return handle(context);
}

export async function onRequestGet(context) {
  return handle(context);
}

async function handle({ request, env }) {
  const password2 = String(env.ROBOKASSA_PASSWORD_2 || "").trim();
  if (!password2) {
    console.error("robokassa.result: ROBOKASSA_PASSWORD_2 is not configured");
    return plain("error", 500);
  }

  let bodyText = "";
  try {
    bodyText = await request.text();
  } catch {
    bodyText = "";
  }
  const params = parseParams(request, bodyText);

  const outSumRaw = get(params, "OutSum");
  const invIdRaw = get(params, "InvId");
  const signature = get(params, "SignatureValue");
  const shpUid = get(params, "Shp_uid");
  const shpItem = get(params, "Shp_item");
  const invId = Number.parseInt(invIdRaw, 10);
  const outSumNum = normalizeOutSum(outSumRaw);

  if (!outSumRaw || !Number.isInteger(invId) || invId <= 0 || !signature) {
    console.warn("robokassa.result: missing/invalid fields", { invId: invIdRaw, hasOutSum: !!outSumRaw, hasSignature: !!signature });
    return plain("bad request", 400);
  }

  // Подпись по фактически полученным Shp_* (в алфавитном порядке внутри resultSignature)
  const shp = {};
  if (shpUid) shp.Shp_uid = shpUid;
  if (shpItem) shp.Shp_item = shpItem;
  const { signature: expected } = resultSignature(env, { outSum: outSumRaw, invId: invIdRaw, shp });
  if (!safeEqualHex(expected, signature)) {
    console.warn("robokassa.result: invalid signature", { invId });
    return plain("bad signature", 400);
  }

  const order = await env.DB.prepare(
    "SELECT inv_id, endemion_sub, item_id, amount, crystals, status FROM orders WHERE inv_id = ?"
  ).bind(invId).first();

  if (!order) {
    console.warn("robokassa.result: unknown order", { invId });
    return plain("not found", 400);
  }

  // Идемпотентность: уже оплачен/обработан
  if (order.status === "paid") {
    return plain(`OK${invId}`);
  }
  if (order.status !== "pending") {
    console.warn("robokassa.result: order not payable", { invId, status: order.status });
    return plain("bad request", 400);
  }

  // Сверка заказа с уведомлением: пользователь, товар, сумма и каталог
  const product = getProduct(order.item_id);
  if (!product) {
    console.error("robokassa.result: unknown product in order", { invId, itemId: order.item_id });
    return plain("error", 500);
  }
  if (shpUid && shpUid !== order.endemion_sub) {
    console.warn("robokassa.result: uid mismatch", { invId });
    return plain("bad request", 400);
  }
  if (shpItem && shpItem !== order.item_id) {
    console.warn("robokassa.result: item mismatch", { invId });
    return plain("bad request", 400);
  }
  if (!Number.isFinite(outSumNum) || Math.round(outSumNum) !== Number(order.amount) || Number(order.amount) !== Number(product.amount)) {
    console.warn("robokassa.result: amount mismatch", { invId, outSumRaw, orderAmount: order.amount, productAmount: product.amount });
    return plain("bad request", 400);
  }
  if (Number(order.crystals) !== Number(product.crystals)) {
    console.error("robokassa.result: crystals mismatch", { invId });
    return plain("error", 500);
  }

  const payloadJson = JSON.stringify(Object.fromEntries(params.entries()));
  const now = new Date().toISOString();
  const reason = `robokassa:inv_id:${invId}`;

  // Claim: переводим заказ в paid только из pending. Это защищает от параллельных начислений.
  const claim = await env.DB.prepare(
    "UPDATE orders SET status = 'paid', robokassa_payload = ?, paid_at = ? WHERE inv_id = ? AND status = 'pending'"
  ).bind(payloadJson, now, invId).run();
  if (!claim.meta || claim.meta.changes !== 1) {
    const current = await env.DB.prepare("SELECT status FROM orders WHERE inv_id = ?").bind(invId).first();
    if (current && current.status === "paid") return plain(`OK${invId}`);
    console.warn("robokassa.result: claim failed", { invId, status: current && current.status });
    return plain("error", 500);
  }

  // Начисление в кошелёк + запись в ledger. UNIQUE(type,reason) защищает от повторного кредита.
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO wallets (endemion_sub, balance, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(endemion_sub) DO UPDATE SET balance = wallets.balance + excluded.balance, updated_at = excluded.updated_at"
      ).bind(order.endemion_sub, Number(order.crystals), now),
      env.DB.prepare(
        "INSERT INTO wallet_transactions (endemion_sub, type, amount, reason, ref_inv_id, meta_json) VALUES (?, 'credit', ?, ?, ?, ?)"
      ).bind(order.endemion_sub, Number(order.crystals), reason, invId, payloadJson)
    ]);
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/unique|constraint/i.test(msg)) {
      // Кредит уже записан ранее — считаем оплату обработанной
      return plain(`OK${invId}`);
    }
    // Заказ помечен paid, но кредит не применился: критичная рассинхронизация для ручного разбора.
    console.error("robokassa.result: credited state but wallet update failed", { invId, err: msg });
    return plain("error", 500);
  }

  return plain(`OK${invId}`);
}