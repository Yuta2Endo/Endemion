// Общие части документов Legal Center: заполнители, разделы о контактах, праве и изменениях,
// шаблоны политики и условий для офлайн-игр на Android. Факты каждой игры — в её файле (tetrus.js, liforae.js и т. д.).
// Разметка текста: [[...]] — поле, которое должен подтвердить разработчик, {{адрес|текст}} — ссылка (functions/legal.js)

export const P = {
  ru: {
    owner: "[[юридическое имя или название разработчика]]",
    email: "[[адрес электронной почты для обращений]]",
    address: "[[почтовый адрес для обращений, если он публикуется]]",
    law: "[[страна, право которой применяется]]",
    courts: "[[суд или порядок рассмотрения споров]]",
    age: "[[минимальный возраст]]",
    audience: "[[целевая возрастная группа, указанная в Google Play Console]]",
    mailRetention: "[[срок хранения переписки]]",
    mailProvider: "[[почтовый сервис и страна]]"
  },
  en: {
    owner: "[[developer's legal name]]",
    email: "[[contact email]]",
    address: "[[postal address for requests, if published]]",
    law: "[[governing law]]",
    courts: "[[courts or dispute resolution procedure]]",
    age: "[[minimum age]]",
    audience: "[[target age group set in Google Play Console]]",
    mailRetention: "[[email retention period]]",
    mailProvider: "[[email provider and country]]"
  }
};

const GOOGLE_PRIVACY = "https://policies.google.com/privacy";
const GOOGLE_REFUNDS = "https://support.google.com/googleplay/answer/2479637";

export function contactSection(lang, title) {
  const p = P[lang];
  return lang === "ru"
    ? { id: "contact", title: "Контакты", body: [
      `Разработчик и издатель ${title}: ${p.owner}, бренд Endemion.`,
      [`Электронная почта: ${p.email}`, `Почтовый адрес: ${p.address}`, "Сайт: {{https://endemion.online|endemion.online}}"]
    ] }
    : { id: "contact", title: "Contact", body: [
      `${title} is developed and published by ${p.owner} under the Endemion brand.`,
      [`Email: ${p.email}`, `Postal address: ${p.address}`, "Website: {{https://endemion.online|endemion.online}}"]
    ] };
}

export function privacyChanges(lang, online = false) {
  if (lang === "ru") {
    return { id: "changes", title: "Изменения политики", body: [
      "Мы можем обновлять эту политику, например когда меняется то, как игра обрабатывает данные. Новая редакция публикуется на этой странице с новой датой последнего обновления.",
      online
        ? "О существенных изменениях мы сообщим заранее на этой странице и, где это уместно, в самой игре."
        : "Если игра начнёт передавать данные с устройства, мы обновим политику до выхода такой версии и укажем это в описании обновления."
    ] };
  }
  return { id: "changes", title: "Changes to this policy", body: [
    "We may update this policy, for example when the way the game handles data changes. The new version is published on this page with a new last-updated date.",
    online
      ? "We will announce material changes in advance on this page and, where appropriate, in the game."
      : "If the game starts sending data from your device, we will update this policy before that version is released and say so in the update notes."
  ] };
}

export function termsCommon(lang) {
  const p = P[lang];
  if (lang === "ru") {
    return {
      disclaimers: "Игра предоставляется «как есть» и «как доступна». Мы не гарантируем, что игра будет работать без ошибок и перерывов на любом устройстве и в любом браузере.",
      liability: { id: "liability", title: "Ограничение ответственности", body: [
        "В пределах, разрешённых применимым правом, мы не отвечаем за косвенные убытки, упущенную выгоду, потерю данных или игрового прогресса.",
        "Ничто в этих условиях не ограничивает ответственность, которую по закону ограничить нельзя, и не лишает вас обязательных прав потребителя."
      ] },
      law: { id: "governing-law", title: "Применимое право", body: [
        `К этим условиям применяется право: ${p.law}. Споры рассматриваются: ${p.courts}.`,
        "Если вы потребитель, это не лишает вас защиты, которую дают обязательные нормы права страны вашего проживания."
      ] },
      changes: { id: "changes", title: "Изменения условий", body: [
        "Мы можем изменять эти условия. Новая редакция публикуется на этой странице с новой датой последнего обновления. О существенных изменениях мы сообщим заранее.",
        "Если вы продолжаете играть после вступления изменений в силу, вы принимаете новые условия. Если вы не согласны, прекратите пользоваться игрой."
      ] }
    };
  }
  return {
    disclaimers: "The game is provided \"as is\" and \"as available\". We do not guarantee that it will work without errors or interruptions on every device or browser.",
    liability: { id: "liability", title: "Limitation of liability", body: [
      "To the extent permitted by applicable law, we are not liable for indirect or consequential damages, lost profits, or loss of data or game progress.",
      "Nothing in these Terms limits liability that cannot be limited by law or takes away your mandatory rights as a consumer."
    ] },
    law: { id: "governing-law", title: "Governing law", body: [
      `These Terms are governed by ${p.law}. Disputes are resolved by ${p.courts}.`,
      "If you are a consumer, this does not take away the protection given to you by the mandatory laws of the country where you live."
    ] },
    changes: { id: "changes", title: "Changes to these Terms", body: [
      "We may change these Terms. The new version is published on this page with a new last-updated date. We will announce material changes in advance.",
      "If you keep playing after the changes take effect, you accept the new Terms. If you do not agree, stop using the game."
    ] }
  };
}

/**
 * Политика офлайн-игры для Android. g — факты игры на одном языке:
 * title, packageId, description, permissions, provided, stored, deletion, children (необязательно), components
 */
export function offlinePrivacy(lang, g) {
  const p = P[lang];
  if (lang === "ru") {
    return { description: g.description, sections: [
      { id: "about", title: "Об этой политике", body: [
        `Эта политика описывает, как обращается с информацией игра ${g.title} для Android (пакет ${g.packageId}). Игру разрабатывает и издаёт ${p.owner} под брендом Endemion («мы»).`,
        "Политика относится только к этой игре. Для сайта endemion.online и аккаунта Endemion ID действует {{/privacy|отдельная политика конфиденциальности}}."
      ] },
      { id: "summary", title: "Коротко", body: [[
        "Игра работает без интернета и не запрашивает доступ к сети.",
        "Мы не собираем, не получаем и не храним ваши персональные данные на своих серверах.",
        "В игре нет рекламы, аналитики и сторонних трекеров.",
        "Прогресс сохраняется только на вашем устройстве.",
        g.permissions[0]
      ]] },
      { id: "information-collected", title: "Информация, которую вы предоставляете", body: g.provided },
      { id: "automatic", title: "Автоматически собираемая информация", body: [
        "Мы не собираем информацию автоматически: в игре нет кода, который отправляет данные по сети.",
        "Чтобы сохранять прогресс, игра хранит на устройстве, в своей закрытой папке приложения:",
        g.stored,
        "Эти файлы не отправляются ни нам, ни кому-либо ещё."
      ] },
      { id: "device", title: "Информация об устройстве", body: [
        "Игра не считывает и не собирает идентификаторы устройства (Android ID, рекламный идентификатор), местоположение, контакты, фото, файлы, микрофон и камеру.",
        ...g.permissions
      ] },
      { id: "advertising", title: "Реклама", body: ["В игре нет рекламы и рекламных SDK. Рекламный идентификатор не используется."] },
      { id: "analytics", title: "Аналитика", body: [
        "В игре нет аналитики, сбора отчётов о сбоях и других SDK для отслеживания.",
        "Общая статистика Google Play, которую видят все разработчики, описана в разделе «Сторонние сервисы»."
      ] },
      { id: "third-party", title: "Сторонние сервисы", body: [
        `В игре нет сторонних SDK, которые собирают данные. ${g.components}`,
        `Google Play. Игру вы скачиваете из Google Play. Google обрабатывает данные о загрузке и вашем устройстве по своей {{${GOOGLE_PRIVACY}|политике конфиденциальности}}. Google показывает разработчикам общую статистику (например, число установок), а если на устройстве разрешена отправка данных об использовании и диагностике — отчёты о сбоях и производительности. В них нет вашего имени и контактов. Мы используем их только для исправления ошибок.`
      ] },
      { id: "usage", title: "Как используются данные", body: [
        "Данные на устройстве использует только сама игра: чтобы хранить прогресс, настройки и достижения. Для рекламы, профилирования и других целей они не используются."
      ] },
      { id: "sharing", title: "Передача данных", body: [
        "Мы не продаём, не сдаём в аренду и не передаём персональные данные. Игра не отправляет нам данные, поэтому передавать нечего.",
        "Мы раскроем информацию, только если этого требует закон, и только ту, что у нас действительно есть (например, ваше письмо нам)."
      ] },
      { id: "retention", title: "Хранение данных", body: [
        "Данные игры остаются на устройстве, пока вы их не удалите (см. «Удаление данных») или не удалите игру.",
        "Автоматическое резервное копирование Android для игры выключено: файлы сохранений не копируются в резервную копию аккаунта Google и не восстанавливаются на новом устройстве.",
        `Если вы пишете нам на почту, переписка хранится: ${p.mailRetention}.`
      ] },
      { id: "security", title: "Безопасность данных", body: [
        "Файлы игры хранятся в её закрытой папке: по стандартным правилам Android другие приложения не могут их прочитать. Файлы не зашифрованы: прогресс может увидеть любой, у кого есть доступ к разблокированному устройству, поэтому защитите устройство блокировкой экрана.",
        "У игры нет подключения к сети, поэтому данные по интернету не передаются."
      ] },
      { id: "children", title: "Конфиденциальность детей", body: [
        "Игра не собирает персональные данные ни у кого, в том числе у детей. В ней нет аккаунтов, чата, рекламы и покупок.",
        ...(g.children || []),
        `Целевая аудитория: ${p.audience}.`
      ] },
      { id: "rights", title: "Ваши права", body: [
        "В зависимости от страны проживания у вас могут быть права в отношении персональных данных, например по Общему регламенту ЕС и Великобритании по защите данных (GDPR), Закону Калифорнии о защите прав потребителей (CCPA) или Федеральному закону № 152-ФЗ «О персональных данных»: узнать, какие данные о вас хранятся, исправить или удалить их, получить копию, возразить против обработки и подать жалобу в надзорный орган.",
        `Из игры мы персональных данных не получаем, поэтому предоставлять или удалять обычно нечего. Данные на устройстве полностью под вашим контролем. С вопросами пишите: ${p.email}.`
      ] },
      { id: "deletion", title: "Удаление данных", body: [
        ...g.deletion,
        `Чтобы удалить все данные игры, удалите её или откройте настройки Android → «Приложения» → ${g.title} → «Хранилище» → «Очистить хранилище». Названия пунктов зависят от устройства.`
      ] },
      { id: "gdpr", title: "GDPR (ЕЭЗ и Великобритания)", body: [
        "Игра не передаёт нам персональные данные, поэтому мы не обрабатываем их как контролёр. Данные на вашем устройстве остаются под вашим контролем.",
        `Если вы пишете нам на почту, контролёр вашего адреса и письма — ${p.owner}. Мы обрабатываем их, чтобы ответить вам, на основании законного интереса отвечать на обращения (ст. 6(1)(f) GDPR), и храним: ${p.mailRetention}.`,
        "Вы можете подать жалобу в орган по защите данных своей страны."
      ] },
      { id: "california", title: "Права жителей Калифорнии", body: [
        "Мы не продаём и не передаём персональную информацию в значении CCPA/CPRA и не используем её для таргетированной рекламы. Игра персональную информацию не собирает.",
        `Если вы пишете нам, адрес почты используется только для ответа. Жители Калифорнии могут направить любой запрос о данных на ${p.email}. Мы не будем ограничивать вас за использование этих прав.`
      ] },
      { id: "transfers", title: "Международная передача данных", body: [
        `Игра не передаёт данные нам или за границу. Если вы пишете нам на почту, письмо обрабатывает наш почтовый сервис: ${p.mailProvider}.`
      ] },
      contactSection(lang, g.title),
      privacyChanges(lang)
    ] };
  }
  return { description: g.description, sections: [
    { id: "about", title: "About this policy", body: [
      `This Privacy Policy explains how ${g.title}, a game for Android (package ${g.packageId}), handles information. The game is developed and published by ${p.owner} under the Endemion brand ("we", "us").`,
      "This policy covers only this game. The endemion.online website and the Endemion ID account have {{/privacy|their own privacy policy}}."
    ] },
    { id: "summary", title: "Summary", body: [[
      "The game works offline and does not request internet access.",
      "We do not collect, receive or store your personal data on our servers.",
      "The game has no advertising, analytics or third-party tracking.",
      "Your progress is saved only on your device.",
      g.permissions[0]
    ]] },
    { id: "information-collected", title: "Information you provide", body: g.provided },
    { id: "automatic", title: "Automatically collected information", body: [
      "We do not collect any information automatically: the game has no code that sends data over the network.",
      "To save your progress, the game stores the following on your device, in its private app storage:",
      g.stored,
      "These files are not sent to us or to anyone else."
    ] },
    { id: "device", title: "Device information", body: [
      "The game does not read or collect device identifiers (such as the Android ID or the advertising ID), your location, contacts, photos, files, microphone or camera.",
      ...g.permissions
    ] },
    { id: "advertising", title: "Advertising", body: ["The game shows no advertising and contains no advertising SDKs. It does not use the advertising ID."] },
    { id: "analytics", title: "Analytics", body: [
      "The game contains no analytics, crash reporting or other tracking SDKs.",
      "General Google Play statistics that every developer sees are described under Third-party services."
    ] },
    { id: "third-party", title: "Third-party services", body: [
      `The game contains no third-party SDKs that collect data. ${g.components}`,
      `Google Play. You download the game from Google Play. Google processes data about the download and your device under the {{${GOOGLE_PRIVACY}|Google Privacy Policy}}. Google shows developers general statistics (for example, the number of installs) and, if your device is allowed to share usage and diagnostics data, crash and performance reports. These do not include your name or contact details. We use them only to fix errors.`
    ] },
    { id: "usage", title: "How we use information", body: [
      "The data on your device is used only by the game itself, to keep your progress, settings and achievements. It is not used for advertising, profiling or any other purpose."
    ] },
    { id: "sharing", title: "Data sharing", body: [
      "We do not sell, rent or share personal data. The game sends no data to us, so there is nothing to share.",
      "We would disclose information only if the law requires it, and only information we actually hold (for example, an email you sent us)."
    ] },
    { id: "retention", title: "Data retention", body: [
      "Game data stays on your device until you delete it (see Data deletion) or uninstall the game.",
      "Android Auto Backup is turned off for the game: save files are not copied to your Google account backup and are not restored on a new device.",
      `If you email us, we keep the correspondence for ${p.mailRetention}.`
    ] },
    { id: "security", title: "Data security", body: [
      "Game files are kept in the game's private storage, which other apps cannot read under standard Android rules. The files are not encrypted: anyone with access to your unlocked device could see your progress, so protect your device with a screen lock.",
      "The game has no network connection, so no data is transferred over the internet."
    ] },
    { id: "children", title: "Children's privacy", body: [
      "The game does not collect personal information from anyone, including children. It has no accounts, chat, advertising or purchases.",
      ...(g.children || []),
      `Intended audience: ${p.audience}.`
    ] },
    { id: "rights", title: "Your rights", body: [
      "Depending on where you live, you may have rights over your personal data, for example under the EU and UK General Data Protection Regulation (GDPR), the California Consumer Privacy Act (CCPA) or Russian Federal Law No. 152-FZ \"On Personal Data\": to find out what data is held about you, to correct or delete it, to receive a copy, to object to processing and to complain to a supervisory authority.",
      `We receive no personal data from the game, so there is usually nothing for us to provide or delete. The data on your device is fully under your control. If you have a question, write to ${p.email}.`
    ] },
    { id: "deletion", title: "Data deletion", body: [
      ...g.deletion,
      `To delete all game data, uninstall the game, or open Android Settings → Apps → ${g.title} → Storage → Clear storage. Menu names depend on your device.`
    ] },
    { id: "gdpr", title: "GDPR (EEA and UK)", body: [
      "The game does not send personal data to us, so we do not process it as a controller. The data on your device stays under your control.",
      `If you email us, ${p.owner} is the controller of your email address and message. We process them to reply to you, based on our legitimate interest in answering requests (Article 6(1)(f) GDPR), and keep them for ${p.mailRetention}.`,
      "You can complain to the data protection authority in your country."
    ] },
    { id: "california", title: "California privacy rights", body: [
      "We do not sell or share personal information as defined by the CCPA/CPRA and do not use it for targeted advertising. The game does not collect personal information.",
      `If you write to us, we use your email address only to reply. California residents can send any privacy request to ${p.email}. We will not discriminate against you for using these rights.`
    ] },
    { id: "transfers", title: "International transfers", body: [
      `The game does not transfer data to us or abroad. If you email us, your message is processed by our email provider: ${p.mailProvider}.`
    ] },
    contactSection(lang, g.title),
    privacyChanges(lang)
  ] };
}

/** Условия офлайн-игры для Android. g — факты игры на одном языке: title, description, eligibility, content, virtual, disclaimer, components */
export function offlineTerms(lang, g) {
  const p = P[lang];
  const c = termsCommon(lang);
  if (lang === "ru") {
    return { description: g.termsDescription, sections: [
      { id: "acceptance", title: "Принятие условий", body: [
        `Эти условия использования — соглашение между вами и ${p.owner}, разработчиком ${g.title} под брендом Endemion («мы»). Устанавливая игру или играя в неё, вы принимаете эти условия. Если вы не согласны, не устанавливайте игру и не пользуйтесь ею.`,
        "При загрузке игры из Google Play также действуют условия Google Play."
      ] },
      { id: "eligibility", title: "Возраст и право пользоваться игрой", body: [
        `Игра предназначена для игроков от ${p.age} лет. Если вы не достигли совершеннолетия в своей стране, эти условия за вас должен принять родитель или законный представитель.`,
        ...(g.eligibility || [])
      ] },
      { id: "license", title: "Лицензия на игру", body: [
        "Мы предоставляем вам личную, ограниченную, неисключительную, непередаваемую и отзывную лицензию устанавливать игру и играть в неё на устройствах Android, которыми вы владеете или пользуетесь, в некоммерческих целях. Вы получаете лицензию, а не право собственности на игру."
      ] },
      { id: "accounts", title: "Аккаунты", body: ["В игре нет аккаунтов и регистрации."] },
      { id: "user-content", title: "Пользовательский контент", body: g.content },
      { id: "online", title: "Сетевые функции", body: ["В игре нет сетевой и многопользовательской игры, чата и общих с другими игроками таблиц рекордов. Игра работает без интернета."] },
      { id: "prohibited", title: "Что запрещено", body: [
        "Запрещается:",
        [
          "копировать, продавать, сдавать в аренду, распространять или публиковать игру и её изменённые версии;",
          "декомпилировать, исследовать устройство игры или изменять её, кроме случаев, когда закон разрешает это несмотря на запрет;",
          "удалять уведомления об авторских правах и товарные знаки;",
          "использовать игру в коммерческих целях без нашего письменного разрешения;",
          "использовать игру с нарушением закона."
        ]
      ] },
      { id: "virtual-items", title: "Виртуальная валюта и предметы", body: g.virtual },
      { id: "purchases", title: "Покупки в игре", body: ["В текущей версии игры нет покупок, подписок и платного контента. Если они появятся, мы обновим эти условия до того, как покупки станут доступны."] },
      { id: "refunds", title: "Возврат средств", body: [
        `Покупок в игре нет, поэтому возвращать внутри игры нечего. Если вы заплатили за игру в Google Play, возврат регулируется {{${GOOGLE_REFUNDS}|правилами возврата Google Play}} и законами о защите прав потребителей вашей страны.`,
        "[[собственные условия возврата разработчика, если они есть]]"
      ] },
      { id: "intellectual-property", title: "Интеллектуальная собственность", body: [
        `Игра, её код, графика, тексты, звуки и другое содержимое, а также название и логотип Endemion принадлежат ${p.owner} или используются по лицензии. Все права, прямо не предоставленные этими условиями, сохраняются за нами.`,
        g.components
      ] },
      { id: "availability", title: "Доступность игры", body: [
        "Игра работает на вашем устройстве без интернета. Мы можем в любой момент прекратить распространение игры или убрать её из Google Play. Установленная копия может продолжить работать, но мы не гарантируем её работу на каждом устройстве и в будущих версиях Android."
      ] },
      { id: "updates", title: "Обновления", body: [
        "Мы можем выпускать обновления, которые меняют, добавляют или убирают функции и содержимое. Без некоторых обновлений игра может работать неправильно. Мы стараемся сохранять прогресс при обновлении, но не можем гарантировать это в каждом случае."
      ] },
      { id: "termination", title: "Прекращение действия", body: [
        "Вы можете перестать пользоваться игрой в любой момент, удалив её. Лицензия прекращается автоматически, если вы нарушаете эти условия; в этом случае удалите игру.",
        "Разделы об интеллектуальной собственности, отказе от гарантий, ограничении ответственности и применимом праве продолжают действовать после прекращения."
      ] },
      { id: "disclaimers", title: "Отказ от гарантий", body: [c.disclaimers, ...(g.disclaimer || [])] },
      c.liability,
      c.law,
      c.changes,
      contactSection(lang, g.title)
    ] };
  }
  return { description: g.termsDescription, sections: [
    { id: "acceptance", title: "Acceptance of Terms", body: [
      `These Terms of Service ("Terms") are an agreement between you and ${p.owner}, the developer of ${g.title} under the Endemion brand ("we", "us"). By installing or playing the game, you accept these Terms. If you do not agree, do not install or use the game.`,
      "The Google Play Terms of Service also apply when you download the game from Google Play."
    ] },
    { id: "eligibility", title: "Eligibility and age", body: [
      `The game is intended for players aged ${p.age} and older. If you are under the age of majority where you live, a parent or guardian must accept these Terms on your behalf.`,
      ...(g.eligibility || [])
    ] },
    { id: "license", title: "License to use the game", body: [
      "We grant you a personal, limited, non-exclusive, non-transferable and revocable license to install and play the game on Android devices that you own or control, for non-commercial purposes. You receive a license, not ownership of the game."
    ] },
    { id: "accounts", title: "User accounts", body: ["The game has no user accounts or registration."] },
    { id: "user-content", title: "User-generated content", body: g.content },
    { id: "online", title: "Online and multiplayer features", body: ["The game has no online or multiplayer play, chat or leaderboards shared with other players. It works without an internet connection."] },
    { id: "prohibited", title: "Prohibited activities", body: [
      "You must not:",
      [
        "copy, sell, rent, distribute or publish the game or modified versions of it;",
        "decompile, reverse engineer or modify the game, except where the law allows this despite this restriction;",
        "remove copyright notices or trademarks;",
        "use the game for commercial purposes without our written permission;",
        "use the game in a way that breaks the law."
      ]
    ] },
    { id: "virtual-items", title: "Virtual currency and items", body: g.virtual },
    { id: "purchases", title: "In-app purchases", body: ["The current version of the game has no in-app purchases, subscriptions or paid content. If they are added, we will update these Terms before they become available."] },
    { id: "refunds", title: "Refunds", body: [
      `The game has no in-app purchases, so there is nothing to refund inside the game. If you paid for the game on Google Play, refunds follow {{${GOOGLE_REFUNDS}|Google Play's refund policies}} and the consumer law of your country.`,
      "[[developer's own refund terms, if any]]"
    ] },
    { id: "intellectual-property", title: "Intellectual property", body: [
      `The game, its code, graphics, texts, sounds and other content, and the Endemion name and logo belong to ${p.owner} or are used under license. All rights not expressly granted in these Terms are reserved.`,
      g.components
    ] },
    { id: "availability", title: "Service availability", body: [
      "The game runs on your device without an internet connection. We may stop distributing the game or remove it from Google Play at any time. An installed copy may keep working, but we do not guarantee that it will work on every device or future version of Android."
    ] },
    { id: "updates", title: "Updates and modifications", body: [
      "We may release updates that change, add or remove features and content. Some updates may be needed for the game to keep working correctly. We try to keep your progress when updating, but cannot guarantee it in every case."
    ] },
    { id: "termination", title: "Suspension and termination", body: [
      "You may stop using the game at any time by uninstalling it. Your license ends automatically if you breach these Terms; in that case, delete the game.",
      "The sections on intellectual property, disclaimers, limitation of liability and governing law remain in effect after termination."
    ] },
    { id: "disclaimers", title: "Disclaimers", body: [c.disclaimers, ...(g.disclaimer || [])] },
    c.liability,
    c.law,
    c.changes,
    contactSection(lang, g.title)
  ] };
}
