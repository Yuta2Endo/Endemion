// Клиент Telegram Bot API: публикация анонсов обновлений в канал @EndemionOfficial.
// Токен бота берётся только из переменной окружения TELEGRAM_BOT_TOKEN (секрет).
// Токен не пишется в логи, не передаётся во фронтенд, не коммитится в репозиторий.

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

function isTemporaryError(status) {
  return status === 429 || status >= 500;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Отправить текстовое сообщение в Telegram-канал.
 * Возвращает { ok, messageId, error, retryAfter }.
 * При временных ошибках (429, 5xx) повторяет запрос с задержкой.
 * Токен не попадает в логи и не возвращается наружу.
 */
export async function sendTelegramMessage(env, chatId, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram бот не настроен: задайте TELEGRAM_BOT_TOKEN.");
  if (!chatId) throw new Error("Не задан канал Telegram: TELEGRAM_CHANNEL.");

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          chat_id: chatId,
          text: String(text).slice(0, MAX_MESSAGE_BYTES),
          // Без parse_mode: только обычный текст, надёжная валидная разметка Telegram
          disable_web_page_preview: false
        })
      });
    } catch (err) {
      lastError = err.message;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      return { ok: false, error: lastError || "Неизвестная ошибка сети Telegram API." };
    }

    if (response.ok) {
      const data = await response.json().catch(() => null);
      return { ok: true, messageId: data?.result?.message_id || null };
    }

    const retryAfter = response.headers.get("Retry-After");
    lastError = `Telegram API ответил ${response.status}`;
    if (response.status === 429) {
      const wait = retryAfter ? Number(retryAfter) * 1000 : RETRY_DELAY_MS * attempt;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(wait);
        continue;
      }
      return { ok: false, error: lastError, retryAfter: retryAfter ? Number(retryAfter) : null };
    }
    if (isTemporaryError(response.status) && attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS * attempt);
      continue;
    }
    return { ok: false, error: lastError };
  }
  return { ok: false, error: lastError || "Неизвестная ошибка Telegram API." };
}
