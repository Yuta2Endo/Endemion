// TETRUS: Android, пакет endemion.tetrus. Факты — LEGAL_CENTER_AUDIT.md §2.1 (export_presets.cfg, autoload/save_manager.gd, APK 1.0.0 debug)

import { offlinePrivacy, offlineTerms } from "./common.js";

const FACTS = {
  ru: {
    title: "TETRUS",
    packageId: "endemion.tetrus",
    description: "Политика конфиденциальности TETRUS: игра работает без интернета, не собирает персональные данные и хранит прогресс только на устройстве.",
    termsDescription: "Условия использования игры TETRUS для Android: лицензия, правила, отказ от гарантий и контакты.",
    permissions: [
      "Игра запрашивает только разрешение на вибрацию.",
      "Разрешение «Вибрация» (android.permission.VIBRATE) нужно для отклика устройства во время игры. Вибрацию можно выключить в настройках игры. Других разрешений, включая доступ к интернету, игра не запрашивает."
    ],
    provided: ["Вы не вводите в игре никакой личной информации: в ней нет текстовых полей, имени игрока и аккаунтов."],
    stored: [
      "настройки: громкость, звук и музыка, вибрация, тряска экрана, управление, тема и эффекты;",
      "статистику по режимам игры и десять лучших результатов в каждом режиме с датой игры;",
      "опыт, уровень, полученные достижения с датой получения, ежедневные задания и серию дней, когда вы играли (в игре она называется «Login streak», но это не вход в аккаунт)."
    ],
    deletion: ["В игре нет кнопки удаления прогресса. Кнопка «RESET CONTROLS» в настройках сбрасывает только настройки управления."],
    children: ["Игра — абстрактная головоломка с падающими блоками, без насилия и общения с другими людьми."],
    components: "Игра создана на движке Godot Engine (лицензия MIT); движок не передаёт данные.",
    content: ["В игре нет пользовательского контента: нельзя вводить текст, загружать или публиковать материалы."],
    virtual: ["В игре нет виртуальной валюты. Награды за уровни и достижения — оформление (темы поля и эффекты); они не имеют денежной стоимости, не продаются и не обмениваются."]
  },
  en: {
    title: "TETRUS",
    packageId: "endemion.tetrus",
    description: "TETRUS Privacy Policy: the game works offline, collects no personal data and keeps your progress only on your device.",
    termsDescription: "Terms of Service for TETRUS on Android: license, rules, disclaimers and contact.",
    permissions: [
      "The game requests only the vibration permission.",
      "The vibration permission (android.permission.VIBRATE) is used for haptic feedback during play. You can turn vibration off in the game settings. The game requests no other permissions, including internet access."
    ],
    provided: ["You do not enter any personal information in the game: it has no text fields, player name or accounts."],
    stored: [
      "settings: volume, sound and music, vibration, screen shake, controls, theme and effects;",
      "statistics for each game mode and your top ten results per mode with the date played;",
      "XP, level, unlocked achievements with their unlock date, daily quests and your streak of days played (shown in the game as \"Login streak\", which is not an account login)."
    ],
    deletion: ["The game has no button that deletes your progress. \"RESET CONTROLS\" in the settings resets only the control settings."],
    children: ["The game is an abstract falling-block puzzle with no violence and no communication with other people."],
    components: "The game is built with Godot Engine (MIT license); the engine does not send data.",
    content: ["The game has no user-generated content: you cannot enter text or upload or publish material."],
    virtual: ["The game has no virtual currency. Rewards for levels and achievements are cosmetic (board themes and effects); they have no monetary value and cannot be sold or exchanged."]
  }
};

export const tetrus = {
  slug: "tetrus",
  title: "TETRUS",
  summary: {
    ru: "Головоломка с падающими блоками для Android. Работает без интернета, данные остаются на устройстве.",
    en: "Falling-block puzzle for Android. Works offline; data stays on your device."
  },
  privacy: { ru: offlinePrivacy("ru", FACTS.ru), en: offlinePrivacy("en", FACTS.en) },
  terms: { ru: offlineTerms("ru", FACTS.ru), en: offlineTerms("en", FACTS.en) }
};
