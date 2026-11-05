// ENDEMION LIFE: браузерная игра life.endemion.online. Факты — LEGAL_CENTER_AUDIT.md §2.4
// (packages/database/prisma/schema.prisma, apps/api/src/session, auth, common/request-logging.ts, infrastructure/nginx, infrastructure/backup).
// Вход через Endemion ID включён на рабочем сервере (GET /api/auth/config, 2026-11-05)

import { P, contactSection, privacyChanges, termsCommon } from "./common.js";

const GAME = "ENDEMION LIFE";

function privacy(lang) {
  const p = P[lang];
  if (lang === "ru") {
    const retention = { logs: "[[срок хранения журналов сервера]]", offsite: "[[срок хранения резервных копий в VK Cloud]]", guests: "[[срок хранения неактивных гостевых игроков]]" };
    return { description: "Политика конфиденциальности ENDEMION LIFE: какие данные собирает браузерная игра, cookie, журналы, хранение и удаление аккаунта.", sections: [
      { id: "about", title: "Об этой политике", body: [
        `Эта политика описывает, как обрабатывает данные браузерная игра ${GAME} на {{https://life.endemion.online|life.endemion.online}}. Оператор — ${p.owner}, бренд Endemion («мы»).`,
        "Вход в игру выполняется через Endemion ID — общий аккаунт сайта endemion.online и игр Endemion. Сам аккаунт Endemion ID, вход через сторонние сервисы и письма Endemion ID описаны в {{/privacy|политике конфиденциальности сайта}}."
      ] },
      { id: "summary", title: "Коротко", body: [[
        "Играть можно гостем, без регистрации; для сохранения прогресса между устройствами — войти через Endemion ID.",
        "Мы храним профиль из Endemion ID, сеансы входа и ваши игровые жизни.",
        "В игре нет рекламы, аналитики, сторонних трекеров и покупок за деньги.",
        "В игре нет чата и других функций, где ваши данные видят другие игроки."
      ]] },
      { id: "information-collected", title: "Информация, которую вы предоставляете", body: [
        "Профиль Endemion ID. Когда вы входите через Endemion ID, игра получает и хранит постоянный номер вашего аккаунта Endemion ID, имя профиля (username), отображаемое имя, ссылку на аватар и адрес электронной почты. Профиль обновляется при сверке сеанса с Endemion ID.",
        "Игровые данные. Имя персонажа (до 40 символов), необязательная строка «зерно» мира, состояние игры, история событий и ваши игровые действия.",
        "Старые аккаунты. Если вы создали аккаунт игры по почте и паролю до перехода на Endemion ID, хранятся адрес почты, отметка о её подтверждении и хеш пароля (сам пароль не хранится). Новые такие аккаунты не создаются.",
        "Не вводите в имя персонажа и «зерно» свои настоящие персональные данные или данные других людей."
      ] },
      { id: "automatic", title: "Автоматически собираемая информация", body: [
        "Гостевой игрок. При первом открытии игры создаётся анонимный игрок и сеанс, чтобы сохранять ваш прогресс без регистрации.",
        "Сеансы. Для каждого устройства хранятся время создания и последнего использования, срок действия, отметка об отзыве и строка браузера (User-Agent, до 256 символов). Вы видите список устройств в разделе «Аккаунт» и можете завершить любой сеанс.",
        "Журналы сервера. Сервер записывает каждый запрос: время, метод, адрес страницы без параметров, код ответа, длительность и IP-адрес; веб-сервер также записывает строку браузера (User-Agent). В базу данных IP-адреса не записываются.",
        "Защита от перебора. Для ограничения частоты запросов IP-адрес и хеш адреса почты хранятся около минуты."
      ] },
      { id: "cookies", title: "Cookie и хранилище браузера", body: [
        "Игра использует только необходимые cookie:",
        [
          "el_session — номер сеанса, чтобы вы оставались в игре. Действует 365 дней или до выхода. В базе хранится только его хеш.",
          "el_oidc — на время входа через Endemion ID, 10 минут.",
          "el_locale — выбранный язык игры, 1 год."
        ],
        "Когда сервер недоступен, игра сохраняет жизни в хранилище браузера (localStorage, ключи endemion-life:v1:…). Эти данные остаются в вашем браузере, пока вы их не удалите. Cookie рекламы и аналитики игра не ставит."
      ] },
      { id: "device", title: "Информация об устройстве", body: ["Игра получает только то, что браузер передаёт с каждым запросом: IP-адрес и строку браузера (User-Agent). Местоположение, камера, микрофон, контакты и файлы не используются."] },
      { id: "advertising", title: "Реклама", body: ["В игре нет рекламы. Данные не используются для рекламы и профилирования."] },
      { id: "analytics", title: "Аналитика", body: ["Игра не использует сервисы аналитики и счётчики посещений. В коде предусмотрена отправка отчётов об ошибках, но на рабочем сервере она выключена; если мы её включим, мы обновим эту политику до этого."] },
      { id: "third-party", title: "Сторонние сервисы", body: [[
        "Endemion ID (auth.endemion.online) — наш сервис входа; см. {{/privacy|политику сайта}}.",
        "VK Cloud (Россия) — хранилище резервных копий базы данных.",
        "Шрифты загружаются с нашего сервера, а не со сторонних."
      ]] },
      { id: "usage", title: "Как используются данные", body: [[
        "чтобы работала игра: сохранение и загрузка жизней, вход, перенос прогресса гостя в аккаунт;",
        "чтобы показать ваше имя и аватар в игре;",
        "чтобы защищать аккаунты и сервер: ограничение попыток входа, расследование сбоев и атак;",
        "чтобы исправлять ошибки и обеспечивать работу сервера."
      ]] },
      { id: "sharing", title: "Передача данных", body: [
        "Мы не продаём данные и не передаём их рекламодателям. Другие игроки ваших данных не видят.",
        "Данные передаются только поставщикам, без которых игра не работает (хранение резервных копий), и государственным органам, когда этого требует закон."
      ] },
      { id: "retention", title: "Хранение данных", body: [[
        "Профиль, сеансы и игровые жизни — пока существует ваш игрок или аккаунт.",
        `Гостевые игроки, которые давно не заходили, — ${retention.guests}.`,
        `Журналы сервера — ограничены объёмом (не более 50 МБ на сервис), более старые записи перезаписываются; срок: ${retention.logs}.`,
        `Ежедневные резервные копии на сервере — 14 дней (последние 7 копий хранятся всегда); копии в VK Cloud — ${retention.offsite}.`,
        "Данные в хранилище браузера — пока вы их не удалите."
      ]] },
      { id: "security", title: "Безопасность данных", body: ["Соединение защищено HTTPS. Cookie сеанса недоступна скриптам страницы (HttpOnly); в базе хранится только хеш токена сеанса. Ключ обновления сеанса Endemion ID хранится в зашифрованном виде. Токен сеанса удаляется из журналов. Никакая защита не абсолютна. [[порядок уведомления об утечке данных]]"] },
      { id: "children", title: "Конфиденциальность детей", body: [
        `Игра не предназначена для детей младше ${p.age} лет. Проверки возраста в игре нет. Если вы считаете, что ребёнок передал нам данные, напишите на ${p.email}, и мы их удалим.`
      ] },
      { id: "rights", title: "Ваши права", body: [
        "Вы можете узнать, какие данные о вас хранятся, получить копию, исправить, удалить их, ограничить обработку или возразить против неё, а также отозвать согласие.",
        `Имя, имя профиля, аватар и почта меняются в {{https://auth.endemion.online/account|аккаунте Endemion ID}}. Сеансы завершаются в разделе «Аккаунт» игры. Остальные запросы отправляйте на ${p.email}; мы отвечаем в сроки, установленные законом.`
      ] },
      { id: "deletion", title: "Удаление данных", body: [
        `Кнопки удаления аккаунта в игре пока нет. Чтобы удалить данные ${GAME} (игрока, сеансы и жизни) или весь аккаунт Endemion ID, напишите на ${p.email} с адреса, привязанного к аккаунту.`,
        "Сохранения в браузере удаляются очисткой данных сайта life.endemion.online в настройках браузера.",
        "После удаления данные остаются в резервных копиях до их замены (см. «Хранение данных»)."
      ] },
      { id: "gdpr", title: "GDPR (ЕЭЗ и Великобритания)", body: [
        `Контролёр данных — ${p.owner}. Основания обработки: исполнение договора (предоставление игры и аккаунта, ст. 6(1)(b)); законный интерес в безопасности и работе сервиса (журналы, защита от перебора, резервные копии, ст. 6(1)(f)); выполнение юридических обязанностей (ст. 6(1)(c)).`,
        "Вы можете подать жалобу в орган по защите данных своей страны."
      ] },
      { id: "california", title: "Права жителей Калифорнии", body: [
        "Мы не продаём и не передаём персональную информацию в значении CCPA/CPRA и не используем её для таргетированной рекламы. Категории собираемой информации: идентификаторы (почта, имя профиля, номер аккаунта, IP-адрес), сведения об активности в интернете (журналы запросов, строка браузера) и игровые данные.",
        `Жители Калифорнии могут запросить сведения о данных, их копию, исправление или удаление по адресу ${p.email}. Мы не будем ограничивать вас за использование этих прав.`
      ] },
      { id: "transfers", title: "Международная передача данных", body: [
        "Сервер игры и резервные копии находятся в России. Если вы играете из другой страны, ваши данные передаются в Россию и обрабатываются там. Для пользователей из ЕЭЗ и Великобритании такая передача выполняется [[механизм передачи данных, например стандартные договорные условия]]."
      ] },
      contactSection(lang, GAME),
      privacyChanges(lang, true)
    ] };
  }
  const retention = { logs: "[[server log retention period]]", offsite: "[[VK Cloud backup retention period]]", guests: "[[retention period for inactive guest players]]" };
  return { description: "ENDEMION LIFE Privacy Policy: what data the browser game collects, cookies, logs, retention and account deletion.", sections: [
    { id: "about", title: "About this policy", body: [
      `This Privacy Policy explains how ${GAME}, a browser game at {{https://life.endemion.online|life.endemion.online}}, processes data. The operator is ${p.owner}, under the Endemion brand ("we", "us").`,
      "You sign in to the game with Endemion ID, the shared account for the endemion.online website and Endemion games. The Endemion ID account itself, sign-in through other services and Endemion ID emails are covered by the {{/privacy|website privacy policy}}."
    ] },
    { id: "summary", title: "Summary", body: [[
      "You can play as a guest without registering, or sign in with Endemion ID to keep your progress across devices.",
      "We store your Endemion ID profile, sign-in sessions and your game lives.",
      "The game has no advertising, analytics, third-party tracking or real-money purchases.",
      "The game has no chat or other features where other players can see your data."
    ]] },
    { id: "information-collected", title: "Information you provide", body: [
      "Endemion ID profile. When you sign in with Endemion ID, the game receives and stores your permanent Endemion ID account number, username, display name, avatar link and email address. The profile is refreshed when the session is checked with Endemion ID.",
      "Game data. Your character's name (up to 40 characters), an optional world seed text, the game state, event history and your game actions.",
      "Older accounts. If you created a game account with an email and password before the move to Endemion ID, we store the email address, whether it was confirmed, and a password hash (not the password itself). No new accounts of this kind are created.",
      "Do not put your real personal data or anyone else's in the character name or seed."
    ] },
    { id: "automatic", title: "Automatically collected information", body: [
      "Guest player. When you first open the game, an anonymous player and session are created so your progress is saved without registration.",
      "Sessions. For each device we store when the session was created and last used, when it expires, whether it was revoked, and the browser string (User-Agent, up to 256 characters). You can see your devices in the Account section and end any session.",
      "Server logs. The server records each request: time, method, page address without parameters, response code, duration and IP address; the web server also records the browser string (User-Agent). IP addresses are not stored in the database.",
      "Abuse protection. To limit request rates, the IP address and a hash of the email address are kept for about one minute."
    ] },
    { id: "cookies", title: "Cookies and browser storage", body: [
      "The game uses only necessary cookies:",
      [
        "el_session: your session, so you stay signed in. Lasts 365 days or until you sign out. Only its hash is stored in the database.",
        "el_oidc: used while you sign in with Endemion ID, 10 minutes.",
        "el_locale: your chosen game language, 1 year."
      ],
      "When the server cannot be reached, the game saves lives in your browser's storage (localStorage, keys endemion-life:v1:…). This data stays in your browser until you delete it. The game sets no advertising or analytics cookies."
    ] },
    { id: "device", title: "Device information", body: ["The game receives only what your browser sends with every request: your IP address and browser string (User-Agent). It does not use your location, camera, microphone, contacts or files."] },
    { id: "advertising", title: "Advertising", body: ["The game shows no advertising. Data is not used for advertising or profiling."] },
    { id: "analytics", title: "Analytics", body: ["The game uses no analytics or visitor counters. The code can send error reports, but this is turned off on the production server; if we turn it on, we will update this policy first."] },
    { id: "third-party", title: "Third-party services", body: [[
      "Endemion ID (auth.endemion.online): our sign-in service; see the {{/privacy|website policy}}.",
      "VK Cloud (Russia): storage for database backups.",
      "Fonts are served from our own server, not from third parties."
    ]] },
    { id: "usage", title: "How we use information", body: [[
      "to run the game: saving and loading lives, signing in, moving guest progress to your account;",
      "to show your name and avatar in the game;",
      "to protect accounts and the server: limiting sign-in attempts, investigating failures and attacks;",
      "to fix errors and keep the server running."
    ]] },
    { id: "sharing", title: "Data sharing", body: [
      "We do not sell data or share it with advertisers. Other players cannot see your data.",
      "Data is shared only with providers the game cannot work without (backup storage) and with public authorities when the law requires it."
    ] },
    { id: "retention", title: "Data retention", body: [[
      "Profile, sessions and game lives: as long as your player or account exists.",
      `Guest players who have not returned for a long time: ${retention.guests}.`,
      `Server logs: limited by size (at most 50 MB per service), older entries are overwritten; period: ${retention.logs}.`,
      `Daily backups on the server: 14 days (the latest 7 copies are always kept); copies in VK Cloud: ${retention.offsite}.`,
      "Data in your browser storage: until you delete it."
    ]] },
    { id: "security", title: "Data security", body: ["Connections are protected with HTTPS. The session cookie is not available to page scripts (HttpOnly), and only a hash of the session token is stored. The Endemion ID refresh key is stored encrypted. The session token is removed from logs. No protection is absolute. [[data breach notification procedure]]"] },
    { id: "children", title: "Children's privacy", body: [
      `The game is not intended for children under ${p.age}. The game does not check age. If you believe a child has given us data, write to ${p.email} and we will delete it.`
    ] },
    { id: "rights", title: "Your rights", body: [
      "You can ask what data we hold about you, get a copy, correct or delete it, restrict or object to processing, and withdraw consent.",
      `Your name, username, avatar and email are changed in your {{https://auth.endemion.online/account|Endemion ID account}}. Sessions are ended in the game's Account section. Send any other request to ${p.email}; we reply within the time limits set by law.`
    ] },
    { id: "deletion", title: "Data deletion", body: [
      `The game does not yet have an account deletion button. To delete your ${GAME} data (player, sessions and lives) or your whole Endemion ID account, write to ${p.email} from the address linked to the account.`,
      "Saves in your browser are deleted by clearing site data for life.endemion.online in your browser settings.",
      "After deletion, data remains in backups until they are replaced (see Data retention)."
    ] },
    { id: "gdpr", title: "GDPR (EEA and UK)", body: [
      `The data controller is ${p.owner}. Legal bases: performance of a contract (providing the game and account, Art. 6(1)(b)); legitimate interest in security and operating the service (logs, abuse protection, backups, Art. 6(1)(f)); compliance with legal obligations (Art. 6(1)(c)).`,
      "You can complain to the data protection authority in your country."
    ] },
    { id: "california", title: "California privacy rights", body: [
      "We do not sell or share personal information as defined by the CCPA/CPRA and do not use it for targeted advertising. Categories collected: identifiers (email, username, account number, IP address), internet activity (request logs, browser string) and game data.",
      `California residents can request to know, access, correct or delete their data at ${p.email}. We will not discriminate against you for using these rights.`
    ] },
    { id: "transfers", title: "International transfers", body: [
      "The game server and backups are located in Russia. If you play from another country, your data is transferred to and processed in Russia. For users in the EEA and UK, this transfer relies on [[transfer mechanism, for example Standard Contractual Clauses]]."
    ] },
    contactSection(lang, GAME),
    privacyChanges(lang, true)
  ] };
}

function terms(lang) {
  const p = P[lang];
  const c = termsCommon(lang);
  if (lang === "ru") {
    return { description: "Условия использования браузерной игры ENDEMION LIFE: аккаунт, правила, игровое золото, доступность и контакты.", sections: [
      { id: "acceptance", title: "Принятие условий", body: [`Эти условия — соглашение между вами и ${p.owner}, оператором ${GAME} под брендом Endemion («мы»). Играя в ${GAME} на life.endemion.online, вы принимаете эти условия. Для аккаунта Endemion ID также действуют {{/terms|условия сайта}}.`] },
      { id: "eligibility", title: "Возраст и право пользоваться игрой", body: [`Игра предназначена для игроков от ${p.age} лет. Если вы не достигли совершеннолетия в своей стране, условия за вас должен принять родитель или законный представитель.`] },
      { id: "license", title: "Лицензия на игру", body: ["Мы предоставляем вам личную, ограниченную, неисключительную, непередаваемую и отзывную лицензию играть в игру в браузере в некоммерческих целях."] },
      { id: "accounts", title: "Аккаунты", body: [
        "Играть можно гостем; прогресс гостя привязан к браузеру и может быть потерян при очистке cookie. Чтобы сохранить прогресс, войдите через Endemion ID — прогресс гостя перейдёт в аккаунт.",
        "Вы отвечаете за сохранность доступа к аккаунту и за действия в нём. Сообщите нам, если подозреваете чужой доступ."
      ] },
      { id: "user-content", title: "Пользовательский контент", body: ["Единственный текст, который вы вводите, — имя персонажа и необязательное «зерно» мира. Другие игроки их не видят. Не используйте в них оскорбления, незаконные материалы и чужие персональные данные."] },
      { id: "online", title: "Сетевые функции", body: ["Игра работает через наш сервер, но в ней нет игры с другими людьми, чата и общих таблиц рекордов. Рынок в игре однопользовательский: цены задаёт игра."] },
      { id: "prohibited", title: "Что запрещено", body: ["Запрещается:", [
        "взламывать игру, сервер или чужие аккаунты, искать и использовать уязвимости вместо того, чтобы сообщить о них;",
        "использовать ботов и скрипты, создающие нагрузку на сервер, и обходить ограничения частоты запросов;",
        "копировать, распространять и использовать игру в коммерческих целях без нашего разрешения;",
        "использовать игру с нарушением закона."
      ]] },
      { id: "virtual-items", title: "Виртуальная валюта и предметы", body: ["Золото, товары и другие ценности в игре вымышлены. Их нельзя купить за деньги, вывести или обменять. Они не имеют денежной стоимости и не являются вашей собственностью; мы можем изменять игровую экономику."] },
      { id: "purchases", title: "Покупки в игре", body: ["Игра бесплатна, в ней нет покупок, подписок и платного контента. Если они появятся, мы обновим эти условия до этого."] },
      { id: "refunds", title: "Возврат средств", body: ["Платежей в игре нет, поэтому возвращать нечего.", "[[собственные условия возврата, если появятся платежи]]"] },
      { id: "intellectual-property", title: "Интеллектуальная собственность", body: [`Игра, её код, тексты, миры, графика, название и логотип Endemion принадлежат ${p.owner} или используются по лицензии. Все права, прямо не предоставленные этими условиями, сохраняются за нами.`] },
      { id: "availability", title: "Доступность игры", body: ["Игра работает через интернет и может быть недоступна во время обслуживания, обновлений и сбоев. Мы не гарантируем постоянную доступность и можем прекратить работу игры, по возможности предупредив заранее."] },
      { id: "updates", title: "Обновления", body: ["Мы можем менять игру: добавлять и убирать функции, менять баланс и формат сохранений. Мы стараемся сохранять прогресс, но не гарантируем этого в каждом случае."] },
      { id: "termination", title: "Приостановка и прекращение", body: [
        "Вы можете перестать играть в любой момент и попросить удалить данные (см. политику конфиденциальности).",
        "Мы можем приостановить или закрыть доступ игрока или аккаунта, который нарушает эти условия или угрожает работе игры.",
        "Разделы об интеллектуальной собственности, отказе от гарантий, ответственности и применимом праве продолжают действовать после прекращения."
      ] },
      { id: "disclaimers", title: "Отказ от гарантий", body: [c.disclaimers, "События, карьеры и экономика в игре вымышлены и не являются финансовыми, юридическими или иными советами."] },
      c.liability,
      c.law,
      c.changes,
      contactSection(lang, GAME)
    ] };
  }
  return { description: "Terms of Service for the ENDEMION LIFE browser game: account, rules, in-game gold, availability and contact.", sections: [
    { id: "acceptance", title: "Acceptance of Terms", body: [`These Terms are an agreement between you and ${p.owner}, the operator of ${GAME} under the Endemion brand ("we", "us"). By playing ${GAME} at life.endemion.online, you accept these Terms. The {{/terms|website terms}} also apply to your Endemion ID account.`] },
    { id: "eligibility", title: "Eligibility and age", body: [`The game is intended for players aged ${p.age} and older. If you are under the age of majority where you live, a parent or guardian must accept these Terms on your behalf.`] },
    { id: "license", title: "License to use the game", body: ["We grant you a personal, limited, non-exclusive, non-transferable and revocable license to play the game in your browser for non-commercial purposes."] },
    { id: "accounts", title: "User accounts", body: [
      "You can play as a guest; guest progress is tied to your browser and may be lost if you clear cookies. To keep your progress, sign in with Endemion ID and your guest progress moves to your account.",
      "You are responsible for keeping access to your account secure and for activity in it. Tell us if you suspect someone else has access."
    ] },
    { id: "user-content", title: "User-generated content", body: ["The only text you enter is your character's name and an optional world seed. Other players cannot see them. Do not use offensive words, illegal material or other people's personal data in them."] },
    { id: "online", title: "Online and multiplayer features", body: ["The game runs through our server, but it has no play with other people, chat or shared leaderboards. The in-game market is single-player and prices are set by the game."] },
    { id: "prohibited", title: "Prohibited activities", body: ["You must not:", [
      "hack the game, the server or other accounts, or exploit vulnerabilities instead of reporting them;",
      "use bots or scripts that load the server, or bypass request rate limits;",
      "copy, distribute or use the game commercially without our permission;",
      "use the game in a way that breaks the law."
    ]] },
    { id: "virtual-items", title: "Virtual currency and items", body: ["Gold, goods and other valuables in the game are fictional. They cannot be bought with money, cashed out or exchanged. They have no monetary value and are not your property; we may change the game economy."] },
    { id: "purchases", title: "In-app purchases", body: ["The game is free and has no purchases, subscriptions or paid content. If they are added, we will update these Terms first."] },
    { id: "refunds", title: "Refunds", body: ["There are no payments in the game, so there is nothing to refund.", "[[refund terms, if payments are added]]"] },
    { id: "intellectual-property", title: "Intellectual property", body: [`The game, its code, texts, worlds, graphics, and the Endemion name and logo belong to ${p.owner} or are used under license. All rights not expressly granted in these Terms are reserved.`] },
    { id: "availability", title: "Service availability", body: ["The game runs over the internet and may be unavailable during maintenance, updates or outages. We do not guarantee continuous availability and may shut the game down, giving notice where possible."] },
    { id: "updates", title: "Updates and modifications", body: ["We may change the game: add or remove features, change the balance or the save format. We try to keep your progress, but cannot guarantee it in every case."] },
    { id: "termination", title: "Suspension and termination", body: [
      "You may stop playing at any time and ask us to delete your data (see the Privacy Policy).",
      "We may suspend or close access for a player or account that breaches these Terms or threatens the operation of the game.",
      "The sections on intellectual property, disclaimers, liability and governing law remain in effect after termination."
    ] },
    { id: "disclaimers", title: "Disclaimers", body: [c.disclaimers, "Events, careers and the economy in the game are fictional and are not financial, legal or other advice."] },
    c.liability,
    c.law,
    c.changes,
    contactSection(lang, GAME)
  ] };
}

export const endemionLife = {
  slug: "endemion-life",
  title: GAME,
  summary: {
    ru: "Браузерный симулятор жизни на life.endemion.online. Вход через Endemion ID, данные на нашем сервере.",
    en: "Browser life simulator at life.endemion.online. Sign-in with Endemion ID; data on our server."
  },
  privacy: { ru: privacy("ru"), en: privacy("en") },
  terms: { ru: terms("ru"), en: terms("en") }
};
