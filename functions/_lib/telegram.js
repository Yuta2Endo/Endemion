// Клиент Telegram Bot API: публикация анонсов обновлений в канал @EndemionOfficial.
// Токен бота берётся только из переменной окружения TELEGRAM_BOT_TOKEN (секрет).
// Токен не пишется в логи, не передаётся во фронтенд, не коммитится в репозиторий.
//
// С сервера api.telegram.org недоступен, поэтому поддерживается режим посредника:
// если заданы TELEGRAM_RELAY_URL и TELEGRAM_RELAY_KEY, сообщение уходит через воркер
// мониторинга (у Cloudflare доступ к Telegram есть), а токен остаётся только там.

const TELEGRAM_API_BASE = "https://api.telegram.org";
// Лимит Telegram на длину текста сообщения — 4096 символов. Оставляем запас.
const MAX_MESSAGE_BYTES = 4000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

/** Видимая часть токена для логов без раскрытия целиком. */
export function maskToken(token) {
  if (!token || typeof token !== "string" || token.length < 8) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/** Адрес воркера-посредника или null, если шлём напрямую в Telegram. */
function relayTarget(env) {
  const base = String(env.TELEGRAM_RELAY_URL || "").trim().replace(/\/+$/, "");
  const key = String(env.TELEGRAM_RELAY_KEY || "").trim();
  return base && key ? `${base}/admin?key=${encodeURIComponent(key)}` : null;
}

function isTemporaryError(status) {
  return status === 429 || status >= 500;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Текст ошибки из ответа: у Telegram это description, у воркера — строка или объект.
 * @param {any} data
 * @param {number} status
 */
function errorText(data, status) {
  if (typeof data?.description === "string" && data.description) return data.description;
  if (typeof data?.error === "string" && data.error) return data.error;
  if (typeof data?.error?.message === "string" && data.error.message) return data.error.message;
  return `Telegram API ответил ${status}`;
}

/**
 * Отправить текстовое сообщение в Telegram-канал.
 * Возвращает { ok, messageId, error, retryAfter }.
 * При временных ошибках (429, 5xx) повторяет запрос с задержкой.
 * Токен не попадает в логи и не возвращается наружу.
 */
export async function sendTelegramMessage(env, chatId, text) {
  const relay = relayTarget(env);
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!relay && !token) throw new Error("Telegram бот не настроен: задайте TELEGRAM_BOT_TOKEN или TELEGRAM_RELAY_URL с TELEGRAM_RELAY_KEY.");
  if (!chatId) throw new Error("Не задан канал Telegram: TELEGRAM_CHANNEL.");

  const message = String(text).slice(0, MAX_MESSAGE_BYTES);
  const target = relay || `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
  // Через посредника — вызов admin-эндпоинта воркера, напрямую — метод бота.
  // Без parse_mode: только обычный текст, надёжная валидная разметка Telegram.
  const body = relay
    ? { method: "sendMessage", params: { chat_id: chatId, text: message, link_preview_options: { is_disabled: false } } }
    : { chat_id: chatId, text: message, disable_web_page_preview: false };

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body)
      });
    } catch (err) {
      lastError = err.message;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      return { ok: false, error: lastError || "Неизвестная ошибка сети Telegram API." };
    }

    const data = await response.json().catch(() => null);
    if (response.ok && data?.ok !== false) {
      return { ok: true, messageId: data?.result?.message_id || null };
    }

    // Воркер отдаёт ответ Telegram как есть, поэтому код ошибки берём из тела.
    const status = Number(data?.error_code) || response.status;
    lastError = errorText(data, response.status);
    const retryAfter = response.headers.get("Retry-After");
    if (status === 429) {
      const wait = retryAfter ? Number(retryAfter) * 1000 : RETRY_DELAY_MS * attempt;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(wait);
        continue;
      }
      return { ok: false, error: lastError, retryAfter: retryAfter ? Number(retryAfter) : null };
    }
    if (isTemporaryError(status) && attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS * attempt);
      continue;
    }
    return { ok: false, error: lastError };
  }
  return { ok: false, error: lastError || "Неизвестная ошибка Telegram API." };
}
