// Little Weather: Android, пакет endemion.littleweather. Факты — LEGAL_CENTER_AUDIT.md §2.2
// (export_presets.cfg, scripts/core/save_manager.gd, APK 0.1.0 debug). Это симулятор погоды в игре, а не прогноз погоды

import { offlinePrivacy, offlineTerms } from "./common.js";

const FACTS = {
  ru: {
    title: "Little Weather",
    packageId: "endemion.littleweather",
    description: "Политика конфиденциальности Little Weather: игра работает без интернета, не использует местоположение и хранит прогресс только на устройстве.",
    termsDescription: "Условия использования игры Little Weather для Android: лицензия, игровая энергия, отказ от гарантий и контакты.",
    permissions: [
      "Игра запрашивает только разрешение на вибрацию и не использует ваше местоположение.",
      "Разрешение «Вибрация» (android.permission.VIBRATE) нужно для отклика устройства во время игры; её можно выключить в настройках. Доступ к интернету, местоположению и уведомлениям игра не запрашивает.",
      "Погода в Little Weather — игровая механика. Игра не показывает реальный прогноз погоды, не обращается к погодным сервисам и не определяет, где вы находитесь."
    ],
    provided: ["Вы не вводите в игре никакой личной информации: в ней нет текстовых полей, имени игрока и аккаунтов."],
    stored: [
      "игровой прогресс: энергию, острова, растения, улучшения, оформление, достижения, статистику и шаг обучения;",
      "настройки: громкость звука и музыки, качество графики, тени, язык и вибрацию;",
      "время последнего сохранения, получения каждого достижения и каждой награды."
    ],
    deletion: [
      "В настройках игры есть кнопка «Сбросить прогресс». Она возвращает прогресс к началу, но сохраняет настройки. Предыдущий прогресс остаётся в резервном файле сохранения игры до следующего сохранения."
    ],
    children: ["Игра — спокойная головоломка без насилия и общения с другими людьми."],
    components: "Игра создана на движке Godot Engine (лицензия MIT) и использует шрифт Nunito (лицензия SIL Open Font License); они не передают данные.",
    content: ["В игре нет пользовательского контента: нельзя вводить текст, загружать или публиковать материалы."],
    virtual: [
      "«Энергия» — игровая валюта. Её можно только заработать в игре и потратить в игровом магазине на семена, улучшения и оформление.",
      "Энергию нельзя купить за деньги, вывести или обменять. Она не имеет денежной стоимости и не является вашей собственностью. При сбросе прогресса или удалении игры энергия и предметы пропадают без компенсации."
    ],
    disclaimer: ["Погода в игре вымышлена. Не используйте игру как источник сведений о реальной погоде."]
  },
  en: {
    title: "Little Weather",
    packageId: "endemion.littleweather",
    description: "Little Weather Privacy Policy: the game works offline, does not use your location and keeps your progress only on your device.",
    termsDescription: "Terms of Service for Little Weather on Android: license, in-game energy, disclaimers and contact.",
    permissions: [
      "The game requests only the vibration permission and does not use your location.",
      "The vibration permission (android.permission.VIBRATE) is used for haptic feedback during play; you can turn it off in the settings. The game does not request internet, location or notification access.",
      "Weather in Little Weather is a game mechanic. The game does not show real weather forecasts, does not contact weather services and does not determine where you are."
    ],
    provided: ["You do not enter any personal information in the game: it has no text fields, player name or accounts."],
    stored: [
      "game progress: energy, islands, plants, upgrades, cosmetics, achievements, statistics and tutorial step;",
      "settings: sound and music volume, graphics quality, shadows, language and vibration;",
      "the time of the last save and the time each achievement and reward was received."
    ],
    deletion: [
      "The game settings have a \"Reset progress\" button. It returns your progress to the start but keeps your settings. The previous progress remains in the game's backup save file until the next save."
    ],
    children: ["The game is a calm puzzle with no violence and no communication with other people."],
    components: "The game is built with Godot Engine (MIT license) and uses the Nunito font (SIL Open Font License); they do not send data.",
    content: ["The game has no user-generated content: you cannot enter text or upload or publish material."],
    virtual: [
      "\"Energy\" is the in-game currency. It can only be earned by playing and spent in the in-game shop on seeds, upgrades and cosmetics.",
      "Energy cannot be bought with money, cashed out or exchanged. It has no monetary value and is not your property. If you reset your progress or uninstall the game, energy and items are lost without compensation."
    ],
    disclaimer: ["The weather in the game is fictional. Do not use the game as a source of information about real weather."]
  }
};

export const littleWeather = {
  slug: "little-weather",
  title: "Little Weather",
  summary: {
    ru: "Уютная головоломка о маленьком облаке для Android. Без интернета и местоположения, данные остаются на устройстве.",
    en: "Cozy puzzle about a little cloud for Android. No internet or location; data stays on your device."
  },
  privacy: { ru: offlinePrivacy("ru", FACTS.ru), en: offlinePrivacy("en", FACTS.en) },
  terms: { ru: offlineTerms("ru", FACTS.ru), en: offlineTerms("en", FACTS.en) }
};
