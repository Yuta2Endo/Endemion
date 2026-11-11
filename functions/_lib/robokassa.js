// Robokassa: каталог товаров, подписи и формирование URL оплаты.

import { createHash } from "node:crypto";

// Фиксированный каталог: цена берётся только отсюда (защита от подмены OutSum).
export const PRODUCTS = {
  gems_100: { itemId: "gems_100", amount: 100, crystals: 100, title: "100 кристаллов" },
  gems_500: { itemId: "gems_500", amount: 450, crystals: 500, title: "500 кристаллов" },
  gems_1000: { itemId: "gems_1000", amount: 850, crystals: 1000, title: "1000 кристаллов" }
};

export function getProduct(itemId) {
  return Object.prototype.hasOwnProperty.call(PRODUCTS, itemId) ? PRODUCTS[itemId] : null;
}

export function signatureAlgo(env) {
  return String(env.ROBOKASSA_SIGNATURE_ALGO || "md5").toLowerCase() === "sha256" ? "sha256" : "md5";
}

export function hashHex(algo, text) {
  return createHash(algo).update(text, "utf8").digest("hex");
}

// Shp_* параметры в алфавитном порядке по имени (ключ=значение через :).
export function shpTail(params) {
  const entries = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (k.startsWith("Shp_")) entries.push([k, String(v)]);
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([k, v]) => `${k}=${v}`).join(":");
}

// Подпись для старта оплаты: MerchantLogin:OutSum:InvId:Password1[:Shp_*]
export function startSignature(env, { outSum, invId, shp }) {
  const login = String(env.ROBOKASSA_MERCHANT_LOGIN || "").trim();
  const pass1 = String(env.ROBOKASSA_PASSWORD_1 || "").trim();
  const algo = signatureAlgo(env);
  let base = `${login}:${outSum}:${invId}:${pass1}`;
  const tail = shpTail(shp);
  if (tail) base += `:${tail}`;
  return { signature: hashHex(algo, base), algo };
}

// Подпись Result URL: OutSum:InvId:Password2[:Shp_*]
export function resultSignature(env, { outSum, invId, shp }) {
  const pass2 = String(env.ROBOKASSA_PASSWORD_2 || "").trim();
  const algo = signatureAlgo(env);
  let base = `${outSum}:${invId}:${pass2}`;
  const tail = shpTail(shp);
  if (tail) base += `:${tail}`;
  return { signature: hashHex(algo, base), algo };
}

export function buildPaymentUrl(env, { invId, outSum, description, shp }) {
  const login = String(env.ROBOKASSA_MERCHANT_LOGIN || "").trim();
  const { signature } = startSignature(env, { outSum, invId, shp });
  const isTest = String(env.ROBOKASSA_IS_TEST || "1") === "1";
  const url = new URL("https://auth.robokassa.ru/Merchant/Index.aspx");
  url.searchParams.set("MerchantLogin", login);
  url.searchParams.set("OutSum", String(outSum));
  url.searchParams.set("InvId", String(invId));
  url.searchParams.set("Description", description || "Пополнение баланса");
  url.searchParams.set("SignatureValue", signature);
  url.searchParams.set("IsTest", isTest ? "1" : "0");
  for (const [k, v] of Object.entries(shp || {})) {
    if (k.startsWith("Shp_")) url.searchParams.set(k, String(v));
  }
  return url.toString();
}