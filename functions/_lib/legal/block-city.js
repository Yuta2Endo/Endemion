// BLOCK CITY: Android, пакет org.blockcity.game. Факты — G:/I/Block City/Block City
// (export_presets.cfg, scripts/managers/SaveManager.gd, SettingsManager.gd, DailyRewardManager.gd, scripts/core/ShopCatalog.gd, версия 1.0.0)

import { offlinePrivacy, offlineTerms } from "./common.js";

const FACTS = {
  ru: {
    title: "BLOCK CITY",
    packageId: "org.blockcity.game",
    description: "Политика конфиденциальности BLOCK CITY: игра работает без интернета, не собирает персональные данные и хранит прогресс только на устройстве.",
    termsDescription: "Условия использования игры BLOCK CITY для Android: лицензия, игровая валюта, отказ от гарантий и контакты.",
    permissions: [
      "Игра запрашивает только разрешение на вибрацию.",
      "Разрешение «Вибрация» (android.permission.VIBRATE) нужно для отклика устройства во время игры. Вибрацию можно выключить в настройках игры. Других разрешений, включая доступ к интернету, игра не запрашивает."
    ],
    provided: ["Вы не вводите в игре никакой личной информации: в ней нет текстовых полей, имени игрока и аккаунтов."],
    stored: [
      "прогресс: монеты, опыт, уровень, лучший результат, число игр и побед, построенные этажи, идеальные установки, лучшие серии и комбо, заработанные монеты и число покупок;",
      "купленные и выбранные предметы оформления: облики зданий, эффекты и города;",
      "полученные достижения, выполненные задания, ежедневные задания и ежедневную награду: дату последнего получения и число дней подряд;",
      "настройки: громкость музыки и звуков, вибрацию, качество графики, показ частоты кадров и тему города."
    ],
    deletion: ["В игре нет кнопки удаления прогресса. Настройки и прогресс можно удалить только вместе с игрой или через настройки Android."],
    children: ["Игра — спокойное строительство башни и города, без насилия и общения с другими людьми."],
    components: "Игра создана на движке Godot Engine (лицензия MIT); движок не передаёт данные.",
    content: ["В игре нет пользовательского контента: нельзя вводить текст, загружать или публиковать материалы."],
    virtual: ["«Монеты» — игровая валюта. Их можно только заработать в игре и потратить в игровом магазине на облики зданий, эффекты и города. Они не имеют денежной стоимости, не продаются и не обмениваются."]
  },
  en: {
    title: "BLOCK CITY",
    packageId: "org.blockcity.game",
    description: "BLOCK CITY Privacy Policy: the game works offline, collects no personal data and keeps your progress only on your device.",
    termsDescription: "Terms of Service for BLOCK CITY on Android: license, in-game currency, disclaimers and contact.",
    permissions: [
      "The game requests only the vibration permission.",
      "The vibration permission (android.permission.VIBRATE) is used for haptic feedback during play. You can turn vibration off in the game settings. The game requests no other permissions, including internet access."
    ],
    provided: ["You do not enter any personal information in the game: it has no text fields, player name or accounts."],
    stored: [
      "progress: coins, XP, level, best score, games played and victories, floors built, perfect placements, best streaks and combos, coins earned and the number of purchases;",
      "owned and selected cosmetic items: building looks, effects and cities;",
      "unlocked achievements, completed missions, daily missions and the daily reward: the date it was last claimed and your streak of days;",
      "settings: music and sound volume, vibration, graphics quality, the frame rate display and the city theme."
    ],
    deletion: ["The game has no button that deletes your progress. Settings and progress can only be removed by uninstalling the game or through Android settings."],
    children: ["The game is a calm tower and city builder with no violence and no communication with other people."],
    components: "The game is built with Godot Engine (MIT license); the engine does not send data.",
    content: ["The game has no user-generated content: you cannot enter text or upload or publish material."],
    virtual: ["\"Coins\" are an in-game currency. You can only earn them by playing and spend them in the in-game shop on building looks, effects and cities. They have no monetary value and cannot be sold or exchanged."]
  }
};

export const blockCity = {
  slug: "block-city",
  title: "BLOCK CITY",
  summary: {
    ru: "3D-игра про строительство города для Android. Работает без интернета, данные остаются на устройстве.",
    en: "3D city-building game for Android. Works offline; data stays on your device."
  },
  privacy: { ru: offlinePrivacy("ru", FACTS.ru), en: offlinePrivacy("en", FACTS.en) },
  terms: { ru: offlineTerms("ru", FACTS.ru), en: offlineTerms("en", FACTS.en) }
};
