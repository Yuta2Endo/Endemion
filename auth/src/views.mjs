// HTML-страницы Endemion ID. Без встроенных скриптов и стилей: CSP разрешает только файлы с этого же адреса.
// Всё, что пришло от пользователя, проходит через escapeHtml

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const PLATFORM_NAMES = { endemion: "Endemion", endemion_life: "Endemion Life" };

export function platformName(platform) {
  return PLATFORM_NAMES[platform] || "Endemion";
}

function layout({ title, content, wide = false, scripts = [] }) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#07061a">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)} — Endemion ID</title>
  <link rel="icon" href="/favicon.ico?v=2" sizes="32x32">
  <link rel="icon" href="/icons/favicon-32x32.png?v=2" type="image/png" sizes="32x32">
  <link rel="icon" href="/icons/favicon-16x16.png?v=2" type="image/png" sizes="16x16">
  <link rel="stylesheet" href="/assets/auth.css">
${scripts.map((src) => `  <script type="module" src="${escapeHtml(src)}"></script>`).join("\n")}
</head>
<body>
  <main class="id-shell${wide ? " id-shell-wide" : ""}">
    <nav class="id-nav">
      <a class="logo" href="/account"><span class="logo-mark" aria-hidden="true">E</span>ENDEMION <span class="logo-id">ID</span></a>
    </nav>
    ${content}
    <footer class="id-footer">Один аккаунт для Endemion и Endemion Life</footer>
  </main>
</body>
</html>`;
}

/**
 * Поле формы с подписью, подсказкой или ошибкой
 * @param {{ name: string, label: string, type?: string, value?: string, autocomplete?: string, required?: boolean, hint?: string, error?: string, extra?: string }} options
 */
function field({ name, label, type = "text", value = "", autocomplete, required = true, hint, error, extra = "" }) {
  const id = `f-${name}`;
  return `<div class="field${error ? " field-invalid" : ""}">
      <label for="${id}">${escapeHtml(label)}</label>
      <input id="${id}" name="${name}" type="${type}" value="${escapeHtml(value)}"${autocomplete ? ` autocomplete="${autocomplete}"` : ""}${required ? " required" : ""}${error ? ` aria-invalid="true" aria-describedby="${id}-error"` : ""} ${extra}>
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
function authLayout({ title, clientPlatform, heading, description, content }) {
  const target = clientPlatform ? platformName(clientPlatform) : null;
  return layout({
    title,
    content: `<section class="id-layout">
      <div class="id-intro">
        <div class="eyebrow">Endemion ID</div>
        <h1>Один вход.<br><span>Все миры Endemion.</span></h1>
        <p>${target ? `Вы входите в <strong>${escapeHtml(target)}</strong>. ` : ""}Один аккаунт для читалки Endemion и игры Endemion Life: имя, аватар и прогресс общие, пароль вводится один раз.</p>
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
    clientPlatform,
    heading: "С возвращением",
    description: "Войдите почтой или именем пользователя.",
    content: `${message(notice, "success")}${message(error)}
      <form method="post" action="/interaction/${escapeHtml(uid)}/login" novalidate>
        ${field({ name: "login", label: "Почта или имя пользователя", value: login, autocomplete: "username", extra: 'maxlength="254" autofocus' })}
        ${field({ name: "password", label: "Пароль", type: "password", autocomplete: "current-password", extra: 'maxlength="128"' })}
        ${mailEnabled ? `<a class="inline-link" href="/forgot-password">Забыли пароль?</a>` : ""}
        <button class="main-button" type="submit">Войти</button>
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
        ${field({ name: "password", label: "Пароль", type: "password", autocomplete: "new-password", error: errors.password, hint: "Не короче 8 символов.", extra: 'minlength="8" maxlength="128"' })}
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
    content: `<section class="id-single id-panel">
      <h2 class="form-title">Новый пароль</h2>
      <p class="form-description">Пришлём на почту ссылку, по которой можно задать новый пароль. Ссылка действует 1 час.</p>
      ${sent ? message("Если аккаунт с этой почтой есть, письмо уже в пути. Проверьте и папку «Спам».", "success") : message(error)}
      <form method="post" action="/forgot-password" novalidate>
        ${field({ name: "email", label: "Почта", type: "email", value: email, autocomplete: "email", extra: 'maxlength="254" autofocus' })}
        <button class="main-button" type="submit">Отправить ссылку</button>
      </form>
    </section>`
  });
}

/** @param {Record<string, any>} options */
export function resetPage({ token, error }) {
  return layout({
    title: "Новый пароль",
    content: `<section class="id-single id-panel">
      <h2 class="form-title">Задайте новый пароль</h2>
      <p class="form-description">После смены пароля вы выйдете из аккаунта на всех устройствах и сайтах.</p>
      ${message(error)}
      <form method="post" action="/reset-password" novalidate>
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        ${field({ name: "password", label: "Новый пароль", type: "password", autocomplete: "new-password", hint: "Не короче 8 символов.", extra: 'minlength="8" maxlength="128" autofocus' })}
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
  return `<nav class="tabs" aria-label="Разделы аккаунта">${item("/account", "Профиль")}${item("/sessions", "Сессии")}${item("/logout", "Выйти")}</nav>`;
}

/**
 * Пароль и внешние провайдеры: что привязано, кнопки привязать и отвязать
 * @param {{ id: string, name: string, enabled: boolean, identity: Record<string, any> | null }[]} methods
 */
function loginMethodsPanel(methods, hasPassword, csrf) {
  const rows = methods.map((method) => {
    const identity = method.identity;
    const who = identity ? [identity.display_name, identity.email].filter(Boolean).join(" · ") : "";
    const action = identity
      ? `<form method="post" action="/account/social/${escapeHtml(method.id)}/unlink">${csrfInput(csrf)}<button class="danger-button" type="submit">Отвязать</button></form>`
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

/** @param {Record<string, any>} options */
export function accountPage({ account, avatarUrl, csrf, notice, error, links, mailEnabled, hasPassword = true, loginMethods = [] }) {
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
          <div><dt>Endemion ID</dt><dd><code>${escapeHtml(account.sub)}</code></dd></div>
          <div><dt>Почта</dt><dd>${escapeHtml(account.email)} <span class="badge ${verified ? "ok" : "warn"}">${verified ? "подтверждена" : "не подтверждена"}</span></dd></div>
          <div><dt>Аккаунт создан</dt><dd>${escapeHtml(formatDate(account.created_at))}</dd></div>
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
          <button class="main-button" type="submit">Загрузить</button>
          <p class="form-message" id="avatarMessage" role="status"></p>
          <noscript><p class="form-description">Для загрузки аватара нужен JavaScript.</p></noscript>
        </form>

        ${loginMethods.length ? loginMethodsPanel(loginMethods, hasPassword, csrf) : ""}

        <form class="id-panel" method="post" action="/account/email" novalidate>
          ${csrfInput(csrf)}
          <h2>Почта</h2>
          ${field({ name: "email", label: "Новая почта", type: "email", autocomplete: "email", extra: 'maxlength="254"' })}
          ${hasPassword
            ? field({ name: "password", label: "Текущий пароль", type: "password", autocomplete: "current-password", extra: 'maxlength="128"' })
            : `<p class="form-description">Пароля нет: вместо него нужен вход не раньше 10 минут назад.</p>`}
          <button class="main-button" type="submit">Сменить почту</button>
        </form>

        <form class="id-panel" method="post" action="/account/password" novalidate>
          ${csrfInput(csrf)}
          <h2>Пароль</h2>
          ${hasPassword
            ? field({ name: "currentPassword", label: "Текущий пароль", type: "password", autocomplete: "current-password", extra: 'maxlength="128"' })
            : `<p class="form-description">Вы входите через внешний сервис. Пароль позволит входить и без него.</p>`}
          ${field({ name: "newPassword", label: "Новый пароль", type: "password", autocomplete: "new-password", hint: "Не короче 8 символов. Остальные сессии завершатся.", extra: 'minlength="8" maxlength="128"' })}
          <button class="main-button" type="submit">${hasPassword ? "Сменить пароль" : "Задать пароль"}</button>
        </form>
      </div>
    </section>`
  });
}

function describeDevice(userAgent) {
  const ua = String(userAgent || "");
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /YaBrowser/.test(ua) ? "Яндекс Браузер" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Браузер";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser}, ${os}` : browser;
}

/** @param {Record<string, any>} options */
export function sessionsPage({ sessions, csrf, notice }) {
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
export function errorPage({ title = "Что-то пошло не так", text, status }) {
  return layout({
    title,
    content: `<section class="id-single id-panel">
      <h2 class="form-title">${escapeHtml(title)}</h2>
      ${message(text)}
      ${status ? `<p class="muted">Код ошибки: ${escapeHtml(status)}</p>` : ""}
      <a class="secondary-button button-link" href="/account">На страницу аккаунта</a>
    </section>`
  });
}
