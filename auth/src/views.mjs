// HTML-страницы Endemion ID. Без встроенных скриптов и стилей: CSP разрешает только файлы с этого же адреса.
// Всё, что пришло от пользователя, проходит через escapeHtml

let legalLinks = null;

/** Ссылки на политику и условия. Задаёт приложение при старте, страницы сами их не знают */
export function useLegal(links) {
  legalLinks = links ? { privacy: links.privacy, terms: links.terms } : null;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const PLATFORM_NAMES = { endemion: "Endemion", endemion_life: "Endemion Life" };

export function platformName(platform) {
  return PLATFORM_NAMES[platform] || "Endemion";
}

function layout({ title, content, wide = false, scripts = [], home = "/account" }) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#080a10">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)} — Endemion ID</title>
  <link rel="icon" href="/favicon.ico?v=2" sizes="32x32">
  <link rel="icon" href="/icons/favicon-32x32.png?v=2" type="image/png" sizes="32x32">
  <link rel="icon" href="/icons/favicon-16x16.png?v=2" type="image/png" sizes="16x16">
  <link rel="stylesheet" href="/assets/auth.css">
  <script type="module" src="/assets/reveal.js"></script>
${scripts.map((src) => `  <script type="module" src="${escapeHtml(src)}"></script>`).join("\n")}
</head>
<body>
  <main class="id-shell${wide ? " id-shell-wide" : ""}">
    <nav class="id-nav">
      <a class="logo" href="${escapeHtml(home)}"><span class="logo-mark" aria-hidden="true">E</span>ENDEMION <span class="logo-id">ID</span></a>
    </nav>
    ${content}
    <footer class="id-footer">Один аккаунт для сайта, форума и Endemion Life${legalLinks ? ` · <a href="${escapeHtml(legalLinks.privacy)}">Политика</a> · <a href="${escapeHtml(legalLinks.terms)}">Условия</a>` : ""}</footer>
  </main>
</body>
</html>`;
}

/**
 * Поле формы с подписью, подсказкой или ошибкой
 * @param {{ name: string, label: string, type?: string, value?: string, autocomplete?: string, required?: boolean, hint?: string, error?: string, extra?: string, id?: string }} options
 */
function field({ name, label, type = "text", value = "", autocomplete, required = true, hint, error, extra = "", id = `f-${name}` }) {
  const reveal = type === "password" ? `<label class="reveal"><input type="checkbox" data-reveal="${id}"><span>Показать</span></label>` : "";
  return `<div class="field${error ? " field-invalid" : ""}">
      <label for="${id}">${escapeHtml(label)}</label>
      ${reveal}<input id="${id}" name="${name}" type="${type}" value="${escapeHtml(value)}"${autocomplete ? ` autocomplete="${autocomplete}"` : ""}${required ? " required" : ""}${error ? ` aria-invalid="true" aria-describedby="${id}-error"` : ""} ${extra}>
      ${error ? `<small class="field-error" id="${id}-error">${escapeHtml(error)}</small>` : hint ? `<small class="field-hint">${escapeHtml(hint)}</small>` : ""}
    </div>`;
}

function message(text, kind = "error") {
  return text ? `<div class="form-message ${kind}" role="${kind === "error" ? "alert" : "status"}">${escapeHtml(text)}</div>` : "";
}

function csrfInput(token) {
  return `<input type="hidden" name="csrf" value="${escapeHtml(token)}">`;
}

/** Две колонки: слева пояснение, куда входит пользователь, справа форма */
function authLayout({ title, clientPlatform, heading, description, content, scripts = [] }) {
  const target = clientPlatform ? platformName(clientPlatform) : null;
  return layout({
    title,
    scripts,
    home: "/login",
    content: `<section class="id-layout">
      <div class="id-intro">
        <div class="id-intro-copy">
          <div class="eyebrow">Endemion ID</div>
          <h1>Один аккаунт.<br><span>Вся экосистема.</span></h1>
          <p>${target ? `Вы входите в <strong>${escapeHtml(target)}</strong>. ` : ""}Игры, форум и сохранения Endemion Life связаны одним профилем: имя, аватар и прогресс общие, пароль вводится один раз.</p>
          <ul class="id-benefits">
            <li><span class="id-benefit-mark" aria-hidden="true">✓</span>Единый пароль для сайта и Endemion Life</li>
            <li><span class="id-benefit-mark" aria-hidden="true">✓</span>Темы, ответы и уведомления в одном месте</li>
            <li><span class="id-benefit-mark" aria-hidden="true">✓</span>Вход по ключу устройства или коду из приложения</li>
          </ul>
        </div>
        <p class="id-trust">Пароль хранится только в виде необратимого хеша. Соединение защищено HTTPS.</p>
      </div>
      <div class="id-panel">
        <h2 class="form-title">${escapeHtml(heading)}</h2>
        ${description ? `<p class="form-description">${escapeHtml(description)}</p>` : ""}
        ${content}
      </div>
    </section>`
  });
}

// Значки провайдеров прямо в разметке: CSP не пускает картинки с чужих адресов, а встроенный SVG — не скрипт и не стиль
const PROVIDER_ICONS = {
  google: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>`,
  vk: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><rect width="24" height="24" rx="6" fill="#0077FF"/><path fill="#fff" d="M12.8 17.3c-5.1 0-8-3.5-8.1-9.3h2.6c.1 4.3 2 6.1 3.4 6.4V8h2.4v3.7c1.5-.2 3-1.8 3.5-3.7h2.4a7.1 7.1 0 0 1-3.2 4.6 7.4 7.4 0 0 1 3.8 4.7h-2.6c-.6-1.8-2-3.2-3.9-3.4v3.4h-.3z"/></svg>`,
  yandex: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><rect width="24" height="24" rx="6" fill="#FC3F1D"/><path fill="#fff" d="M13.4 19.2h-2.3V7.6H9.6V5.6h5.7c2.4 0 3.8 1.3 3.8 3.3 0 2.1-1.5 3.4-3.7 3.4h-2zm0-8.7h1.3c1.3 0 2-.7 2-1.7s-.7-1.6-2-1.6h-1.3z"/></svg>`,
  github: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17.3 4.8 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z"/></svg>`,
  discord: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="#5865F2" d="M20.3 4.5a19.3 19.3 0 0 0-4.8-1.5.1.1 0 0 0-.1 0c-.2.4-.4.9-.6 1.3a18 18 0 0 0-5.4 0c-.2-.4-.4-.9-.6-1.3a.1.1 0 0 0-.1 0 19.3 19.3 0 0 0-4.8 1.5.1.1 0 0 0 0 .1C1.4 8.8.8 12.9 1.2 17a.1.1 0 0 0 .1.1 19.4 19.4 0 0 0 5.9 3 .1.1 0 0 0 .1 0c.5-.7.9-1.4 1.3-2.1a.1.1 0 0 0-.1-.1 12.8 12.8 0 0 1-1.8-.9.1.1 0 0 1 0-.2l.4-.3a.1.1 0 0 1 .1 0c3.7 1.7 7.7 1.7 11.4 0a.1.1 0 0 1 .1 0l.4.3a.1.1 0 0 1 0 .2c-.6.3-1.2.6-1.8.9a.1.1 0 0 0 0 .1c.4.8.8 1.5 1.3 2.1a.1.1 0 0 0 .1 0 19.3 19.3 0 0 0 5.9-3 .1.1 0 0 0 .1-.1c.5-4.7-.8-8.8-3.4-12.4a.1.1 0 0 0 0-.1zM8.7 14.5c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3c1.1 0 2 1 2 2.3s-.9 2.3-2 2.3zm6.6 0c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3c1.1 0 2 1 2 2.3s-.9 2.3-2 2.3z"/></svg>`
};

/**
 * Кнопки «Войти через …». Каждая — форма POST: вход у провайдера не начнётся по ссылке с чужого сайта
 * @param {string} uid
 * @param {{ id: string, name: string }[]} providers
 */
function socialButtons(uid, providers) {
  if (!providers?.length) return "";
  return `<div class="social-divider"><span>или</span></div>
      <div class="social-buttons">
        ${providers.map((provider) => `<form method="post" action="/interaction/${escapeHtml(uid)}/social/${escapeHtml(provider.id)}">
          <button class="social-button social-${escapeHtml(provider.id)}" type="submit">${PROVIDER_ICONS[provider.id] || ""}<span>Войти через ${escapeHtml(provider.name)}</span></button>
        </form>`).join("\n        ")}
      </div>`;
}

/** @param {Record<string, any>} options */
export function loginPage({ uid, clientPlatform, login = "", error, notice, mailEnabled, providers = [] }) {
  return authLayout({
    title: "Вход",
    scripts: ["/assets/passkey.js"],
    clientPlatform,
    heading: "С возвращением",
    description: "Ключ доступа, если он есть на этом устройстве. Иначе — почта и пароль.",
    content: `${message(notice, "success")}${message(error)}
      <button class="main-button" type="button" id="passkeyLogin" data-uid="${escapeHtml(uid)}" hidden>Войти ключом доступа</button>
      <form method="post" action="/interaction/${escapeHtml(uid)}/login" novalidate>
        ${field({ name: "login", label: "Почта или имя пользователя", value: login, autocomplete: "username webauthn", extra: 'maxlength="254"' })}
        ${field({ name: "password", label: "Пароль", type: "password", autocomplete: "current-password", extra: 'maxlength="128"' })}
        ${mailEnabled ? `<a class="inline-link" href="/forgot-password">Забыли пароль?</a>` : ""}
        <button class="main-button" type="submit">Войти паролем</button>
      </form>
      ${socialButtons(uid, providers)}
      <p class="switch-link">Нет аккаунта? <a href="/interaction/${escapeHtml(uid)}/register">Создать Endemion ID</a></p>`
  });
}

/** @param {Record<string, any>} options */
export function registerPage({ uid, clientPlatform, values = {}, errors = {}, error, privacyUrl, providers = [] }) {
  return authLayout({
    title: "Регистрация",
    clientPlatform,
    heading: "Создать Endemion ID",
    description: "Аккаунт подойдёт для всех сервисов Endemion.",
    content: `${message(error)}
      <form method="post" action="/interaction/${escapeHtml(uid)}/register" novalidate>
        ${field({ name: "email", label: "Почта", type: "email", value: values.email, autocomplete: "email", error: errors.email, extra: 'maxlength="254" autofocus' })}
        ${field({ name: "username", label: "Имя пользователя", value: values.username, autocomplete: "username", error: errors.username, hint: "Латинские буквы, цифры и _, от 3 до 24 символов. Будет в адресе профиля.", extra: 'minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}"' })}
        ${field({ name: "displayName", label: "Отображаемое имя", value: values.displayName, autocomplete: "nickname", required: false, error: errors.displayName, hint: "Как вас видят другие. Можно не заполнять.", extra: 'maxlength="40"' })}
        ${field({ name: "password", label: "Пароль", type: "password", autocomplete: "new-password", error: errors.password, hint: "Не короче 8 и не длиннее 128 символов. Не совпадает с именем и почтой.", extra: 'minlength="8" maxlength="128"' })}
        ${field({ name: "confirmPassword", label: "Ещё раз", type: "password", autocomplete: "new-password", error: errors.confirmPassword, extra: 'minlength="8" maxlength="128"' })}
        <label class="consent${errors.consent ? " field-invalid" : ""}">
          <input type="checkbox" name="consent" value="1"${values.consent ? " checked" : ""} required>
          <span>Я согласен(на) с <a href="${escapeHtml(privacyUrl)}" target="_blank" rel="noopener">политикой конфиденциальности</a> и обработкой моих данных.</span>
        </label>
        ${errors.consent ? `<small class="field-error">${escapeHtml(errors.consent)}</small>` : ""}
        <button class="main-button" type="submit">Создать аккаунт</button>
      </form>
      ${socialButtons(uid, providers)}
      <p class="switch-link">Уже есть аккаунт? <a href="/interaction/${escapeHtml(uid)}">Войти</a></p>`
  });
}

/**
 * Первый вход через провайдера: почта, username и согласие. Пароль не нужен
 * @param {Record<string, any>} options
 */
export function socialCompletePage({ uid, token, providerName, clientPlatform, values = {}, errors = {}, error, privacyUrl }) {
  return authLayout({
    title: "Завершите регистрацию",
    clientPlatform,
    heading: "Завершите регистрацию",
    description: `Вы вошли через ${providerName}. Осталось выбрать имя пользователя и указать почту — на неё придёт письмо для подтверждения.`,
    content: `${message(error)}
      <form method="post" action="/interaction/${escapeHtml(uid)}/social" novalidate>
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        ${field({ name: "email", label: "Почта", type: "email", value: values.email, autocomplete: "email", error: errors.email, extra: 'maxlength="254" autofocus' })}
        ${field({ name: "username", label: "Имя пользователя", value: values.username, autocomplete: "username", error: errors.username, hint: "Латинские буквы, цифры и _, от 3 до 24 символов. Будет в адресе профиля.", extra: 'minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}"' })}
        ${field({ name: "displayName", label: "Отображаемое имя", value: values.displayName, autocomplete: "nickname", required: false, error: errors.displayName, hint: "Как вас видят другие. Можно не заполнять.", extra: 'maxlength="40"' })}
        <label class="consent${errors.consent ? " field-invalid" : ""}">
          <input type="checkbox" name="consent" value="1"${values.consent ? " checked" : ""} required>
          <span>Я согласен(на) с <a href="${escapeHtml(privacyUrl)}" target="_blank" rel="noopener">политикой конфиденциальности</a> и обработкой моих данных.</span>
        </label>
        ${errors.consent ? `<small class="field-error">${escapeHtml(errors.consent)}</small>` : ""}
        <button class="main-button" type="submit">Создать Endemion ID</button>
      </form>
      <p class="switch-link">Уже есть Endemion ID? <a href="/interaction/${escapeHtml(uid)}">Войдите в него</a> и привяжите ${escapeHtml(providerName)} на странице аккаунта.</p>`
  });
}

/** @param {Record<string, any>} options */
export function verifyPage({ token }) {
  return layout({
    title: "Подтверждение почты",
    content: `<section class="id-single id-panel">
      <h2 class="form-title">Подтвердите почту</h2>
      <p class="form-description">Нажмите кнопку, чтобы подтвердить адрес для Endemion ID.</p>
      <form method="post" action="/verify-email">
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        <button class="main-button" type="submit" autofocus>Подтвердить</button>
      </form>
    </section>`
  });
}

/** @param {Record<string, any>} options */
export function forgotPage({ email = "", error, sent }) {
  return layout({
    title: "Восстановление пароля",
    home: "/login",
    content: `<section class="id-single id-panel">
      <h2 class="form-title">Новый пароль</h2>
      <p class="form-description">Пришлём на почту ссылку, по которой можно задать новый пароль. Ссылка действует 1 час.</p>
      ${sent ? message("Если аккаунт с этой почтой есть, письмо уже в пути. Проверьте и папку «Спам».", "success") : message(error)}
      <form method="post" action="/forgot-password" novalidate>
        ${field({ name: "email", label: "Почта", type: "email", value: email, autocomplete: "email", extra: 'maxlength="254" autofocus' })}
        <button class="main-button" type="submit">Отправить ссылку</button>
      </form>
      <p class="switch-link"><a href="/login">Назад ко входу</a></p>
    </section>`
  });
}

/** @param {Record<string, any>} options */
export function unrecognizedPage({ token, error }) {
  return layout({
    title: "Это были не вы",
    home: "/login",
    content: `<section class="id-single id-panel">
      <h2 class="form-title">Это были не вы?</h2>
      <p class="form-description">Новый пароль сразу завершит все сессии и входы на сайтах Endemion. Ссылка из письма больше не сработает.</p>
      ${message(error)}
      <form method="post" action="/login-alert" novalidate>
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        ${field({ name: "password", label: "Новый пароль", type: "password", autocomplete: "new-password", hint: "Не короче 8 и не длиннее 128 символов.", extra: 'minlength="8" maxlength="128" autofocus' })}
        ${field({ name: "confirmPassword", label: "Ещё раз", type: "password", autocomplete: "new-password", extra: 'minlength="8" maxlength="128"' })}
        <button class="main-button" type="submit">Сменить пароль и выйти везде</button>
      </form>
    </section>`
  });
}

export function resetPage({ token, error }) {
  return layout({
    title: "Новый пароль",
    home: "/login",
    content: `<section class="id-single id-panel">
      <h2 class="form-title">Задайте новый пароль</h2>
      <p class="form-description">После смены пароля вы выйдете из аккаунта на всех устройствах и сайтах.</p>
      ${message(error)}
      <form method="post" action="/reset-password" novalidate>
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        ${field({ name: "password", label: "Новый пароль", type: "password", autocomplete: "new-password", hint: "Не короче 8 и не длиннее 128 символов.", extra: 'minlength="8" maxlength="128" autofocus' })}
        ${field({ name: "confirmPassword", label: "Ещё раз", type: "password", autocomplete: "new-password", extra: 'minlength="8" maxlength="128"' })}
        <button class="main-button" type="submit">Сохранить пароль</button>
      </form>
    </section>`
  });
}

/**
 * Простая страница с сообщением и ссылкой дальше
 * @param {Record<string, any>} options
 */
export function noticePage({ title, text, kind = "success", link }) {
  return layout({
    title,
    content: `<section class="id-single id-panel">
      <h2 class="form-title">${escapeHtml(title)}</h2>
      ${message(text, kind)}
      ${link ? `<a class="main-button button-link" href="${escapeHtml(link.href)}">${escapeHtml(link.text)}</a>` : ""}
    </section>`
  });
}

function avatarBlock(account, avatarUrl) {
  const letter = escapeHtml((account.display_name || account.username || "?").trim().charAt(0).toUpperCase());
  return avatarUrl
    ? `<img class="avatar" src="${escapeHtml(avatarUrl)}" alt="" width="96" height="96">`
    : `<div class="avatar" aria-hidden="true">${letter}</div>`;
}

function formatDate(value) {
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Moscow" });
}

function accountNav(active) {
  const item = (href, text) => `<a href="${href}"${active === href ? ' aria-current="page"' : ""}>${text}</a>`;
  return `<nav class="tabs" aria-label="Разделы аккаунта">${item("/account", "Профиль")}${item("/account/security", "Безопасность")}${item("/sessions", "Сессии")}${item("/account/apps", "Приложения")}${item("/account/data", "Данные")}${item("/logout", "Выйти")}</nav>`;
}

function codeField(suffix) {
  return field({ name: "code", id: `f-code-${suffix}`, label: "Код из приложения", autocomplete: "one-time-code", extra: 'inputmode="numeric" maxlength="6" pattern="[0-9]{6}"' });
}

/**
 * Пароль и внешние провайдеры: что привязано, кнопки привязать и отвязать
 * @param {{ id: string, name: string, enabled: boolean, identity: Record<string, any> | null }[]} methods
 */
function loginMethodsPanel(methods, hasPassword, csrf, totp) {
  const rows = methods.map((method) => {
    const identity = method.identity;
    const who = identity ? [identity.display_name, identity.email].filter(Boolean).join(" · ") : "";
    const action = identity
      ? `<form method="post" action="/account/social/${escapeHtml(method.id)}/unlink">${csrfInput(csrf)}${totp ? codeField(method.id) : ""}<button class="danger-button" type="submit">Отвязать</button></form>`
      : method.enabled
        ? `<form method="post" action="/account/social/${escapeHtml(method.id)}/link">${csrfInput(csrf)}<button class="secondary-button" type="submit">Привязать</button></form>`
        : "";
    return `<li class="method-row">
          <div class="method-name">${PROVIDER_ICONS[method.id] || ""}<div>
            <strong>${escapeHtml(method.name)}</strong>
            <p class="muted">${identity ? `Привязан ${escapeHtml(formatDate(identity.linked_at))}${who ? ` · ${escapeHtml(who)}` : ""}` : "Не привязан"}</p>
          </div></div>
          ${action}
        </li>`;
  }).join("");
  return `<section class="id-panel" aria-labelledby="methodsTitle">
          <h2 id="methodsTitle">Способы входа</h2>
          <p class="form-description">Входите в Endemion и Endemion Life любым из них. Аккаунты объединяются только здесь, по вашему действию: совпадение почты их не связывает. Перед привязкой и отвязкой нужен вход не раньше 10 минут назад.</p>
          <ul class="method-list">
            <li class="method-row">
              <div class="method-name"><span class="method-icon" aria-hidden="true">✱</span><div>
                <strong>Пароль</strong>
                <p class="muted">${hasPassword ? "Задан" : "Не задан — задайте его ниже, чтобы входить и без провайдера"}</p>
              </div></div>
            </li>
            ${rows}
          </ul>
        </section>`;
}

/** @param {Record<string, any>} account */
function protectionList(account) {
  const items = [
    [account.verified, "Почта подтверждена", "/account"],
    [account.hasPassword, "Задан пароль", "/account/security"],
    [account.totp, "Код из приложения", "/account/security"],
    [account.passkeys > 0, "Ключ доступа", "/account/security"]
  ];
  return `<ul class="checklist">${items.map(([ok, text, href]) => `<li><a href="${href}"><span class="badge ${ok ? "ok" : "warn"}">${ok ? "есть" : "нет"}</span> ${escapeHtml(text)}</a></li>`).join("")}</ul>`;
}

export function accountPage({ account, avatarUrl, csrf, notice, error, links, mailEnabled, hasPassword = true, totp = false, passkeys = 0, _loginMethods = [] }) {
  const verified = Boolean(account.email_verified_at);
  return layout({
    title: "Аккаунт",
    wide: true,
    scripts: ["/assets/account.js"],
    content: `${accountNav("/account")}
    ${message(notice, "success")}${message(error)}
    <section class="account-grid">
      <div class="id-panel profile-card">
        ${avatarBlock(account, avatarUrl)}
        <h1>${escapeHtml(account.display_name)}</h1>
        <p class="muted">@${escapeHtml(account.username)}</p>
        <dl class="facts">
          <div><dt>Endemion ID</dt><dd><code id="accountId">${escapeHtml(account.sub)}</code> <button class="secondary-button" type="button" id="copyId" data-copy="${escapeHtml(account.sub)}">Копировать</button></dd></div>
          <div><dt>Почта</dt><dd>${escapeHtml(account.email)} <span class="badge ${verified ? "ok" : "warn"}">${verified ? "подтверждена" : "не подтверждена"}</span></dd></div>
          <div><dt>Аккаунт создан</dt><dd>${escapeHtml(formatDate(account.created_at))}</dd></div>
          <div><dt>Защита</dt><dd>${protectionList({ verified, hasPassword, totp, passkeys })}</dd></div>
        </dl>
        ${!verified && mailEnabled ? `<form method="post" action="/account/verify-email">${csrfInput(csrf)}<button class="secondary-button" type="submit">Отправить письмо ещё раз</button></form>` : ""}
        <div class="go-links">
          <a class="secondary-button button-link" href="${escapeHtml(links.site)}">Endemion</a>
          <a class="secondary-button button-link" href="${escapeHtml(links.life)}">Endemion Life</a>
        </div>
      </div>

      <div class="account-forms">
        <form class="id-panel" method="post" action="/account/profile" novalidate>
          ${csrfInput(csrf)}
          <h2>Профиль</h2>
          ${field({ name: "displayName", label: "Отображаемое имя", value: account.display_name, autocomplete: "nickname", extra: 'minlength="2" maxlength="40"' })}
          ${field({ name: "username", label: "Имя пользователя", value: account.username, autocomplete: "username", hint: "Имя меняется на обоих сайтах. Прогресс привязан к Endemion ID и не пропадёт.", extra: 'minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}"' })}
          <button class="main-button" type="submit">Сохранить</button>
        </form>

        <form class="id-panel" id="avatarForm" method="post" action="/account/avatar" enctype="multipart/form-data" data-csrf="${escapeHtml(csrf)}">
          <h2>Аватар</h2>
          <p class="form-description">PNG, JPEG или WebP до 2 МБ. Появится на Endemion и в Endemion Life.</p>
          <div class="field"><label for="avatarFile">Файл</label><input id="avatarFile" name="avatar" type="file" accept="image/png,image/jpeg,image/webp" required></div>
          <img id="avatarPreview" class="avatar" alt="" hidden>
          <button class="main-button" type="submit">Загрузить</button>
          <p class="form-message" id="avatarMessage" role="status"></p>
          <noscript><p class="form-description">Для загрузки аватара нужен JavaScript.</p></noscript>
        </form>

      </div>
    </section>`
  });
}

const SCOPE_LABELS = { openid: "идентификатор", email: "почта", profile: "имя и аватар", offline_access: "оставаться в системе" };

/** @param {string} csrf @param {Record<string, any> | null} totp */
function totpPanel(csrf, totp) {
  if (totp?.enabled) {
    return `<section class="id-panel" aria-labelledby="totpTitle">
      <h2 id="totpTitle">Код из приложения</h2>
      <p class="form-description">Включён. При входе, в том числе через провайдера, нужен код. Запасных кодов осталось: ${escapeHtml(totp.backups)}. Новые коды заменяют старые.</p>
      <form method="post" action="/account/totp/backups" novalidate>
        ${csrfInput(csrf)}
        ${field({ name: "code", label: "Текущий код", autocomplete: "one-time-code", extra: 'inputmode="numeric" maxlength="6" pattern="[0-9]{6}"' })}
        <button class="secondary-button" type="submit">Новые запасные коды</button>
      </form>
      <form method="post" action="/account/totp/disable" novalidate>
        ${csrfInput(csrf)}
        ${field({ name: "code", label: "Текущий код или запасной код", autocomplete: "one-time-code", extra: 'inputmode="numeric" maxlength="9" pattern="[0-9A-Za-z -]{6,9}"' })}
        <button class="danger-button" type="submit">Выключить</button>
      </form>
    </section>`;
  }
  return `<section class="id-panel" aria-labelledby="totpTitle">
      <h2 id="totpTitle">Код из приложения</h2>
      <p class="form-description">После пароля или входа через провайдера сайт спросит код из Яндекс Ключа, Google Authenticator или другого приложения. Нужен вход не раньше 10 минут назад.</p>
      <form method="post" action="/account/totp/start">${csrfInput(csrf)}<button class="secondary-button" type="submit">Включить</button></form>
    </section>`;
}

export function totpSetupPage({ csrf, secret, otpauth, error }) {
  const groups = secret.match(/.{4}/g)?.join(" ") || secret;
  return layout({
    title: "Код из приложения",
    home: "/account/security",
    content: `<section class="id-single id-panel">
      <h2 class="form-title">Добавьте Endemion в приложение</h2>
      <p class="form-description">В Яндекс Ключе или Google Authenticator выберите ввод ключа вручную и введите его. Затем пришлите код, чтобы включение подтвердилось.</p>
      <p class="totp-secret"><code>${escapeHtml(groups)}</code></p>
      <p class="muted">Или добавьте по ссылке: <a class="inline-link" href="${escapeHtml(otpauth)}">открыть приложение</a></p>
      ${message(error)}
      <form method="post" action="/account/totp/confirm" novalidate>
        ${csrfInput(csrf)}
        ${field({ name: "code", label: "Код из приложения", autocomplete: "one-time-code", extra: 'inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autofocus' })}
        <button class="main-button" type="submit">Подтвердить и включить</button>
      </form>
    </section>`
  });
}

export function backupCodesPage({ codes }) {
  return layout({
    title: "Запасные коды",
    home: "/account/security",
    content: `<section class="id-single id-panel">
      <h2 class="form-title">Сохраните запасные коды</h2>
      <p class="form-description">Каждый код входит один раз, если телефона нет рядом. Больше они не покажутся.</p>
      <ul class="totp-codes">${codes.map((code) => `<li><code>${escapeHtml(code)}</code></li>`).join("")}</ul>
      <a class="main-button button-link" href="/account/security">Я сохранил коды</a>
    </section>`
  });
}

export function totpLoginPage({ uid, error }) {
  return layout({
    title: "Код из приложения",
    home: "/login",
    content: `<section class="id-single id-panel">
      <h2 class="form-title">Код из приложения</h2>
      <p class="form-description">Пароль принят. Введите код или один запасной код.</p>
      ${message(error)}
      <form method="post" action="/interaction/${escapeHtml(uid)}/totp" novalidate>
        ${field({ name: "code", label: "Код", autocomplete: "one-time-code", extra: 'inputmode="numeric" maxlength="9" autofocus' })}
        <button class="main-button" type="submit">Войти</button>
      </form>
    </section>`
  });
}

function passkeyPanel(csrf, passkeys, totp) {
  const rows = passkeys.map((item) => `<li class="method-row">
      <div class="method-name"><span class="method-icon" aria-hidden="true">⚿</span><div>
        <strong>${escapeHtml(item.name)}</strong>
        <p class="muted">Добавлен ${escapeHtml(formatDate(item.created_at))}</p>
      </div></div>
      <form method="post" action="/account/passkey/rename">${csrfInput(csrf)}<input type="hidden" name="id" value="${escapeHtml(item.id)}">${field({ name: "name", id: `f-name-${item.id}`, label: "Название", value: item.name, required: true, extra: 'maxlength="40"' })}<button class="secondary-button" type="submit">Переименовать</button></form>
      <form method="post" action="/account/passkey/delete">${csrfInput(csrf)}${totp ? codeField(item.id) : ""}<input type="hidden" name="id" value="${escapeHtml(item.id)}"><button class="danger-button" type="submit">Удалить</button></form>
    </li>`).join("");
  return `<section class="id-panel" aria-labelledby="passkeyTitle">
      <h2 id="passkeyTitle">Ключи доступа</h2>
      <p class="form-description">Вход лицом, отпечатком или ключом устройства. Пароль остаётся запасным способом. Нужен вход не раньше 10 минут назад.</p>
      ${rows ? `<ul class="method-list">${rows}</ul>` : ""}
      <button class="secondary-button" type="button" id="passkeyAdd" data-csrf="${escapeHtml(csrf)}" hidden>Добавить этот ключ</button>
    </section>`;
}

export function securityPage({ csrf, notice, error, mailEnabled, hasPassword = true, loginMethods = [], verified = true, totp = null, passkeys = [] }) {
  return layout({
    title: "Безопасность",
    wide: true,
    scripts: ["/assets/passkey.js"],
    content: `${accountNav("/account/security")}
    ${message(notice, "success")}${message(error)}
    <section class="account-forms">
      ${passkeyPanel(csrf, passkeys, totp)}
      ${totpPanel(csrf, totp)}
      ${loginMethods.length ? loginMethodsPanel(loginMethods, hasPassword, csrf, totp) : ""}
      <form class="id-panel" method="post" action="/account/email" novalidate>
        ${csrfInput(csrf)}
        <h2>Почта</h2>
        ${verified ? "" : `<p class="form-description">Текущая почта ещё не подтверждена.${mailEnabled ? "" : " Отправка писем сейчас выключена."}</p>`}
        ${field({ name: "email", label: "Новая почта", type: "email", autocomplete: "email", extra: 'maxlength="254"' })}
        ${hasPassword
          ? field({ name: "password", label: "Текущий пароль", type: "password", autocomplete: "current-password", extra: 'maxlength="128"' })
          : `<p class="form-description">Пароля нет: вместо него нужен вход не раньше 10 минут назад.</p>`}
        ${totp ? codeField("email") : ""}
        <button class="main-button" type="submit">Сменить почту</button>
      </form>
      <form class="id-panel" method="post" action="/account/password" novalidate>
        ${csrfInput(csrf)}
        <h2>Пароль</h2>
        ${hasPassword
          ? field({ name: "currentPassword", label: "Текущий пароль", type: "password", autocomplete: "current-password", extra: 'maxlength="128"' })
          : `<p class="form-description">Вы входите через внешний сервис. Пароль позволит входить и без него.</p>`}
          ${field({ name: "newPassword", label: "Новый пароль", type: "password", autocomplete: "new-password", hint: "Не короче 8 и не длиннее 128 символов. Не совпадает с именем и почтой. Остальные сессии завершатся.", extra: 'minlength="8" maxlength="128"' })}
          ${field({ name: "confirmPassword", label: "Ещё раз", type: "password", autocomplete: "new-password", extra: 'minlength="8" maxlength="128"' })}
          ${totp ? codeField("password") : ""}
        <button class="main-button" type="submit">${hasPassword ? "Сменить пароль" : "Задать пароль"}</button>
      </form>
    </section>`
  });
}

/** @param {Record<string, any>} options */
export function appsPage({ apps, csrf, notice }) {
  const rows = apps.length
    ? apps.map((app) => `<li class="session-row">
        <div>
          <strong>${escapeHtml(app.name)}</strong>
          <p class="muted">Доступ: ${escapeHtml(app.scopes.map((scope) => SCOPE_LABELS[scope] || scope).join(", ") || "базовый")}${app.lastSeen ? ` · последний вход ${escapeHtml(formatDate(app.lastSeen))}` : ""}</p>
        </div>
        <form method="post" action="/account/apps/revoke">${csrfInput(csrf)}<input type="hidden" name="id" value="${escapeHtml(app.id)}"><button class="danger-button" type="submit">Отозвать</button></form>
      </li>`).join("")
    : `<li class="muted">Пока ни одно приложение не получало доступ.</li>`;
  return layout({
    title: "Приложения",
    wide: true,
    content: `${accountNav("/account/apps")}
    ${message(notice, "success")}
    <section class="id-panel">
      <h2>Приложения с доступом</h2>
      <p class="form-description">Отзыв сразу выходит из этого приложения. На этом устройстве вход в Endemion ID сохранится.</p>
      <ul class="session-list">${rows}</ul>
    </section>`
  });
}

/** @param {Record<string, any>} options */
export function dataPage({ account, csrf, totp = false, error }) {
  return layout({
    title: "Данные",
    wide: true,
    content: `${accountNav("/account/data")}
    ${message(error)}
    <section class="account-forms">
      <section class="id-panel">
        <h2>Экспорт</h2>
        <p class="form-description">Имя, почта, способы входа, приложения и последние 100 событий. Пароль, коды и ключи в файл не попадают.</p>
        <a class="secondary-button button-link" href="/account/export">Скачать JSON</a>
      </section>
      <form class="id-panel" method="post" action="/account/delete" novalidate>
        ${csrfInput(csrf)}
        <h2>Удалить аккаунт</h2>
        <p class="form-description">Профиль, сессии и доступ приложений удалятся. Прогресс на сайтах Endemion при этом не стирается. Войти этим аккаунтом больше не получится.</p>
        ${field({ name: "confirm", label: "Введите имя пользователя", autocomplete: "off", hint: account.username, extra: 'maxlength="24"' })}
        ${account.hasPassword
          ? field({ name: "password", label: "Текущий пароль", type: "password", autocomplete: "current-password", extra: 'maxlength="128"' })
          : `<p class="form-description">Пароля нет: нужен вход не раньше 10 минут назад.</p>`}
        ${totp ? codeField("delete") : ""}
        <button class="danger-button" type="submit">Удалить навсегда</button>
      </form>
    </section>`
  });
}

export function describeDevice(userAgent) {
  const ua = String(userAgent || "");
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /YaBrowser/.test(ua) ? "Яндекс Браузер" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Браузер";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser}, ${os}` : browser;
}

/** @param {Record<string, any>} options */
const ACTIVITY = {
  "login.success": "Вход по паролю",
  "login.invalid": "Неверный пароль",
  "login.locked": "Вход закрыт после неверных паролей",
  "login.blocked": "Попытка входа в заблокированный аккаунт",
  "social.login": "Вход через провайдера",
  "passkey.login": "Вход ключом доступа",
  "totp.failed": "Неверный код",
  "totp.success": "Код подтверждён",
  "password.change": "Пароль изменён",
  "password.set": "Пароль задан",
  "password.reset": "Пароль сброшен",
  "email.change": "Почта изменена",
  "email.verified": "Почта подтверждена",
  "session.revoke": "Сессия завершена",
  "passkey.add": "Ключ доступа добавлен",
  "passkey.delete": "Ключ доступа удалён",
  "social.link": "Способ входа привязан",
  "social.unlink": "Способ входа отвязан",
  "totp.enabled": "Код из приложения включён",
  "totp.disabled": "Код из приложения выключен",
  "app.revoke": "Доступ приложения отозван",
  "account.delete": "Аккаунт удалён"
};

export function sessionsPage({ sessions, csrf, notice, activity = [] }) {
  const rows = sessions.map((session) => `<li class="session-row">
      <div>
        <strong>${escapeHtml(describeDevice(session.userAgent))}</strong>${session.current ? ' <span class="badge ok">это устройство</span>' : ""}
        <p class="muted">Вход: ${escapeHtml(formatDate(session.loginTs))}${session.ip ? ` · ${escapeHtml(session.ip)}` : ""}</p>
        <p class="muted">Сайты: ${escapeHtml(session.platforms.map(platformName).join(", ") || "только Endemion ID")}</p>
      </div>
      ${session.current ? "" : `<form method="post" action="/sessions/revoke">${csrfInput(csrf)}<input type="hidden" name="id" value="${escapeHtml(session.id)}"><button class="danger-button" type="submit">Завершить</button></form>`}
    </li>`).join("");
  return layout({
    title: "Сессии",
    wide: true,
    content: `${accountNav("/sessions")}
    ${message(notice, "success")}
    <section class="id-panel">
      <h2>Активные сессии</h2>
      <p class="form-description">Завершённая сессия выходит из Endemion и Endemion Life на том устройстве.</p>
      <ul class="session-list">${rows}</ul>
      ${sessions.length > 1 ? `<form method="post" action="/sessions/revoke-others">${csrfInput(csrf)}<button class="danger-button" type="submit">Завершить все, кроме этой</button></form>` : ""}
    </section>
    <section class="id-panel">
      <h2>Недавние входы</h2>
      <p class="form-description">Последние 20 событий. Если видите чужой адрес — завершите остальные сессии и смените пароль.</p>
      <ul class="session-list">${activity.length ? activity.map((item) => `<li class="session-row">
        <div>
          <strong>${escapeHtml(ACTIVITY[item.event] || "Событие")}</strong>
          <p class="muted">${escapeHtml(formatDate(item.created_at))}${item.ip ? ` · ${escapeHtml(item.ip)}` : ""}</p>
        </div>
      </li>`).join("") : `<li class="muted">Пока пусто.</li>`}</ul>
    </section>`
  });
}

/**
 * Подтверждение выхода. form — скрытая форма от oidc-provider с защитой от CSRF (xsrf)
 * @param {Record<string, any>} options
 */
export function logoutPage({ form, clientPlatform }) {
  return layout({
    title: "Выход",
    content: `<section class="id-single id-panel">
      <h2 class="form-title">Выйти из Endemion ID?</h2>
      <p class="form-description">${clientPlatform ? `Выход запрошен сайтом ${escapeHtml(platformName(clientPlatform))}. ` : ""}Можно выйти везде сразу или остаться в аккаунте.</p>
      ${form}
      <button class="main-button" type="submit" form="op.logoutForm" name="logout" value="yes" autofocus>Выйти со всех сайтов Endemion</button>
      <button class="secondary-button wide" type="submit" form="op.logoutForm">${clientPlatform ? `Выйти только из ${escapeHtml(platformName(clientPlatform))}` : "Остаться в аккаунте"}</button>
    </section>`
  });
}

/** @param {Record<string, any>} options */
export function errorPage({ title = "Что-то пошло не так", text, status, retry = false }) {
  const action = retry
    ? `<a class="main-button button-link" href="/login">Войти снова</a>`
    : `<a class="secondary-button button-link" href="/account">На страницу аккаунта</a>`;
  return layout({
    title,
    home: retry ? "/login" : "/account",
    content: `<section class="id-single id-panel">
      <h2 class="form-title">${escapeHtml(title)}</h2>
      ${message(text)}
      ${status ? `<p class="muted">Код ошибки: ${escapeHtml(status)}</p>` : ""}
      ${action}
    </section>`
  });
}
