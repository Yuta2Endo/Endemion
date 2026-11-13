// Robokassa: подписи, создание заказа и обработка уведомления об оплате.
// Начисление кристаллов происходит только в result.js, поэтому проверяем его отдельно и строго.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "./helpers/app.mjs";
import { buildPaymentUrl, resultSignature, shpTail, startSignature } from "../functions/_lib/robokassa.js";
import * as result from "../functions/api/robokassa/result.js";

const LOGIN = "endemion-test";
const PASS1 = "password-one-0123456789";
const PASS2 = "password-two-0123456789";

const md5 = (text) => createHash("md5").update(text, "utf8").digest("hex").toUpperCase();

let app;

before(async () => {
  app = await createApp();
  Object.assign(app.env, {
    ROBOKASSA_MERCHANT_LOGIN: LOGIN,
    ROBOKASSA_PASSWORD_1: PASS1,
    ROBOKASSA_PASSWORD_2: PASS2,
    ROBOKASSA_SIGNATURE_ALGO: "md5",
    ROBOKASSA_IS_TEST: "1"
  });
});

after(async () => {
  await app.close();
});

/** Заказ в состоянии pending: сумма и кристаллы берутся из каталога товаров */
async function seedOrder(itemId = "gems_100", amount = 100, crystals = 100, status = "pending") {
  const row = await app.db.prepare(
    `INSERT INTO orders (endemion_sub, item_id, amount, crystals, status)
     VALUES ('sub-test-user', ?, ?, ?, ?) RETURNING inv_id`
  ).bind(itemId, amount, crystals, status).first();
  return Number(row.inv_id);
}

/** Уведомление Robokassa: form-urlencoded тело с корректной подписью */
async function notify({ invId, outSum = "100.000000", password2 = PASS2, shp = {}, overrides = {} }) {
  const params = { OutSum: outSum, InvId: String(invId), ...shp };
  // Подпись считаем выбранным паролем, а обработчику отдаём настоящий: так проверяем чужую подпись
  const { signature } = resultSignature({ ...app.env, ROBOKASSA_PASSWORD_2: password2 }, { outSum, invId: String(invId), shp });
  const body = new URLSearchParams({ ...params, SignatureValue: signature, ...overrides }).toString();
  const response = await result.onRequestPost({
    request: new Request(`http://localhost/api/robokassa/result`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }),
    env: app.env
  });
  return { status: response.status, text: await response.text() };
}

async function wallet(sub = "sub-test-user") {
  const row = await app.db.prepare("SELECT balance FROM wallets WHERE endemion_sub = ?").bind(sub).first();
  return row ? Number(row.balance) : null;
}

async function orderRow(invId) {
  return app.db.prepare("SELECT status, paid_at, robokassa_payload FROM orders WHERE inv_id = ?").bind(invId).first();
}

test("подписи считаются по правилам Robokassa", () => {
  const { signature, outSum } = startSignature(app.env, { outSum: 100, invId: 7 });
  assert.equal(outSum, "100.00");
  assert.equal(signature, md5(`${LOGIN}:100.00:7:${PASS1}`));

  // Shp_* в конце подписи, в алфавитном порядке имён
  const withShp = startSignature(app.env, { outSum: 450, invId: 8, shp: { Shp_item: "gems_500", Shp_uid: "sub-1" } });
  assert.equal(withShp.signature, md5(`${LOGIN}:450.00:8:${PASS1}:Shp_item=gems_500:Shp_uid=sub-1`));

  // SHA256 — тем же алфавитом, но другим хешем
  const sha = startSignature({ ...app.env, ROBOKASSA_SIGNATURE_ALGO: "sha256" }, { outSum: 100, invId: 7 });
  assert.equal(sha.signature, createHash("sha256").update(`${LOGIN}:100.00:7:${PASS1}`, "utf8").digest("hex").toUpperCase());

  // Хвост не зависит от порядка в объекте
  assert.equal(shpTail({ Shp_uid: "u", Shp_item: "i" }), "Shp_item=i:Shp_uid=u");
  assert.equal(shpTail({}), "");

  // Ссылка оплаты: сумма в формате 100.00, InvId и Shp_* на месте, тестовый режим включён
  const url = new URL(buildPaymentUrl(app.env, { invId: 9, outSum: 100, description: "100 кристаллов", shp: { Shp_uid: "sub-1", Shp_item: "gems_100" } }));
  assert.equal(url.origin + url.pathname, "https://auth.robokassa.ru/Merchant/Index.aspx");
  assert.equal(url.searchParams.get("MerchantLogin"), LOGIN);
  assert.equal(url.searchParams.get("OutSum"), "100.00");
  assert.equal(url.searchParams.get("InvId"), "9");
  assert.equal(url.searchParams.get("IsTest"), "1");
  assert.equal(url.searchParams.get("Shp_uid"), "sub-1");
  assert.equal(url.searchParams.get("SignatureValue"), md5(`${LOGIN}:100.00:9:${PASS1}:Shp_item=gems_100:Shp_uid=sub-1`));
});

test("оплата зачисляется один раз, повтор уведомления безопасен", async () => {
  const invId = await seedOrder();
  const shp = { Shp_uid: "sub-test-user", Shp_item: "gems_100" };

  const first = await notify({ invId, shp });
  assert.equal(first.status, 200);
  assert.equal(first.text, `OK${invId}`);

  const row = await orderRow(invId);
  assert.equal(row.status, "paid");
  assert.ok(row.paid_at);
  assert.ok(row.robokassa_payload.includes("SignatureValue"));
  assert.equal(await wallet(), 100);

  const credit = await app.db.prepare("SELECT type, amount, reason FROM wallet_transactions WHERE ref_inv_id = ?").bind(invId).all();
  assert.equal(credit.results.length, 1);
  assert.equal(credit.results[0].type, "credit");
  assert.equal(credit.results[0].amount, 100);
  assert.equal(credit.results[0].reason, `robokassa:inv_id:${invId}`);

  // Robokassa повторяет уведомление, если не получила ответ: баланс не должен вырасти
  const repeat = await notify({ invId, shp });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.text, `OK${invId}`);
  assert.equal(await wallet(), 100);
  assert.equal((await app.db.prepare("SELECT COUNT(*) AS n FROM wallet_transactions WHERE ref_inv_id = ?").bind(invId).first()).n, 1);
});

test("чужая подпись и подмена суммы не зачисляют деньги", async () => {
  const invId = await seedOrder();

  const forged = await notify({ invId, password2: "wrong-password" });
  assert.equal(forged.status, 400);
  assert.equal(forged.text, "bad signature");
  assert.equal(await wallet(), 100, "баланс не изменился");
  assert.equal((await orderRow(invId)).status, "pending");

  // Корректная подпись на неправильную сумму: подпись сходится, но сумма не совпадает с заказом
  const cheap = await notify({ invId, outSum: "1.000000" });
  assert.equal(cheap.status, 400);
  assert.equal(cheap.text, "bad request");
  assert.equal((await orderRow(invId)).status, "pending");
});

test("подмена товара, пользователя и неизвестный заказ отклоняются", async () => {
  const invId = await seedOrder();
  const wrongItem = await notify({ invId, shp: { Shp_item: "gems_1000", Shp_uid: "sub-test-user" } });
  assert.equal(wrongItem.status, 400);
  assert.equal((await orderRow(invId)).status, "pending");

  const wrongUser = await notify({ invId, shp: { Shp_item: "gems_100", Shp_uid: "sub-other" } });
  assert.equal(wrongUser.status, 400);
  assert.equal((await orderRow(invId)).status, "pending");

  const missing = await notify({ invId: 999999 });
  assert.equal(missing.status, 400);
  assert.equal(missing.text, "not found");
});

test("отменённый заказ и неверные поля не проходят", async () => {
  const canceled = await seedOrder("gems_100", 100, 100, "canceled");
  const blocked = await notify({ invId: canceled });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.text, "bad request");

  const fields = await result.onRequestPost({
    request: new Request("http://localhost/api/robokassa/result", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "OutSum=100&InvId=abc&SignatureValue=deadbeef"
    }),
    env: app.env
  });
  assert.equal(fields.status, 400);

  const noPassword = await result.onRequestPost({
    request: new Request("http://localhost/api/robokassa/result", { method: "POST", body: "OutSum=100&InvId=1&SignatureValue=AA" }),
    env: { ...app.env, ROBOKASSA_PASSWORD_2: "" }
  });
  assert.equal(noPassword.status, 500);
});
