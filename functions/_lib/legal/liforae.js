// Liforae: Android, пакет com.liforae.game. Факты — LEGAL_CENTER_AUDIT.md §2.3
// (export_presets.cfg, scripts/infrastructure/save_manager.gd, scripts/ui/screens/create_screen.gd, APK 0.3.0)

import { offlinePrivacy, offlineTerms } from "./common.js";

const FACTS = {
  ru: {
    title: "Liforae",
    packageId: "com.liforae.game",
    description: "Политика конфиденциальности Liforae: игра работает без интернета, не запрашивает разрешений и хранит сохранения только на устройстве.",
    termsDescription: "Условия использования игры Liforae для Android: лицензия, игровые деньги, темы игры, отказ от гарантий и контакты.",
    permissions: [
      "Игра не запрашивает никаких разрешений Android.",
      "Liforae не запрашивает разрешений Android, в том числе доступа к интернету. Язык игры по умолчанию выбирается по языку устройства; сохраняется только выбранный язык."
    ],
    provided: [
      "При создании персонажа вы можете ввести его имя и фамилию (до 20 символов каждое) или оставить случайные. Вы также выбираете пол персонажа, а в ходе игры — его романтические предпочтения.",
      "Это данные вымышленного персонажа. Не вводите в эти поля свои настоящие персональные данные или данные других людей. Введённое хранится только в файле сохранения на устройстве и никуда не отправляется."
    ],
    stored: [
      "настройки: язык, автосохранение, размер текста и анимации;",
      "сохранения (автосохранение и три слота): имя, фамилию и пол персонажа, его игровую дату рождения, романтические предпочтения, семью, отношения, образование, карьеру, игровые деньги, здоровье, историю жизни и решения, а также дату и время сохранения по часам устройства."
    ],
    deletion: [
      "Сохранения в слотах 1–3 можно удалить в игре: окно сохранений → значок корзины → подтверждение. Слот, в котором идёт текущая игра, удалить нельзя. Служебное автосохранение в игре не удаляется."
    ],
    children: ["Игра — симулятор жизни. В ней есть темы, которые могут не подходить детям: курение, вымышленная лотерея, смерть и утрата, болезни, романтические отношения, развод, драки и травля, мошенничество и долги."],
    components: "Игра создана на движке Godot Engine (лицензия MIT); движок не передаёт данные.",
    content: [
      "Единственный текст, который вы вводите, — имя и фамилия персонажа. Они остаются на вашем устройстве и не видны другим людям.",
      "Не используйте в них оскорбления и чужие персональные данные."
    ],
    virtual: [
      "Деньги в игре (евро) и предметы, которые на них покупаются, вымышлены. Их нельзя купить за настоящие деньги, вывести или обменять. Они не имеют денежной стоимости и не являются вашей собственностью."
    ],
    eligibility: ["В игре есть темы для взрослой аудитории (см. «Отказ от гарантий»)."],
    disclaimer: [
      "Liforae — вымышленная симуляция жизни. События, карьеры, болезни, финансы, законы и отношения в игре упрощены и не являются медицинскими, финансовыми, юридическими или иными советами.",
      "Игра изображает курение, лотерею, долги и другие рискованные решения как часть вымышленной жизни и не призывает к ним."
    ]
  },
  en: {
    title: "Liforae",
    packageId: "com.liforae.game",
    description: "Liforae Privacy Policy: the game works offline, requests no permissions and keeps saves only on your device.",
    termsDescription: "Terms of Service for Liforae on Android: license, in-game money, game themes, disclaimers and contact.",
    permissions: [
      "The game requests no Android permissions.",
      "Liforae requests no Android permissions, including internet access. The default game language is chosen from your device language; only the selected language is saved."
    ],
    provided: [
      "When you create a character, you can type its first and last name (up to 20 characters each) or keep random ones. You also choose the character's gender and, during play, its romantic preference.",
      "These are details of a fictional character. Do not enter your own real personal data or anyone else's. Whatever you enter is stored only in the save file on your device and is not sent anywhere."
    ],
    stored: [
      "settings: language, autosave, text size and animations;",
      "saves (an autosave and three slots): the character's first and last name, gender, in-game birth date, romantic preference, family, relationships, education, career, in-game money, health, life story and decisions, and the date and time of saving from your device clock."
    ],
    deletion: [
      "Saves in slots 1–3 can be deleted in the game: save window → trash icon → confirm. The slot you are currently playing cannot be deleted. The internal autosave cannot be deleted in the game."
    ],
    children: ["The game is a life simulator. It includes themes that may not suit children: smoking, a fictional lottery, death and grief, illness, romantic relationships, divorce, fights and bullying, scams and debt."],
    components: "The game is built with Godot Engine (MIT license); the engine does not send data.",
    content: [
      "The only text you enter is the character's first and last name. It stays on your device and is not visible to other people.",
      "Do not use offensive words or other people's personal data in it."
    ],
    virtual: [
      "In-game money (euros) and the items bought with it are fictional. They cannot be bought with real money, cashed out or exchanged. They have no monetary value and are not your property."
    ],
    eligibility: ["The game includes themes intended for an adult audience (see Disclaimers)."],
    disclaimer: [
      "Liforae is a fictional life simulation. Events, careers, illnesses, finances, laws and relationships in the game are simplified and are not medical, financial, legal or other advice.",
      "The game depicts smoking, lotteries, debt and other risky choices as part of a fictional life and does not encourage them."
    ]
  }
};

export const liforae = {
  slug: "liforae",
  title: "Liforae",
  summary: {
    ru: "Симулятор жизни для Android. Работает без интернета и без разрешений, сохранения остаются на устройстве.",
    en: "Life simulator for Android. Works offline with no permissions; saves stay on your device."
  },
  privacy: { ru: offlinePrivacy("ru", FACTS.ru), en: offlinePrivacy("en", FACTS.en) },
  terms: { ru: offlineTerms("ru", FACTS.ru), en: offlineTerms("en", FACTS.en) }
};
