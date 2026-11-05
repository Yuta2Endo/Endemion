// Язык страницы: cookie `lang` (ставит переключатель), иначе заголовок Accept-Language.
// Словарь покрывает каркас сайта — шапку, подвал и поиск. Тексты разделов переводятся постепенно

export const LANGS = ["ru", "en"];
const COOKIE = /(?:^|;\s*)lang=(ru|en)(?:;|$)/;

export function langOf(request) {
  const cookie = COOKIE.exec(request.headers.get("cookie") || "");
  if (cookie) return cookie[1];
  const header = request.headers.get("accept-language") || "";
  return /^en\b/i.test(header) ? "en" : "ru";
}

const STRINGS = {
  ru: {
    nav: { home: "Главная", games: "Игры", community: "Сообщество", studio: "Разработка", about: "О студии" },
    search: "Поиск",
    searchPlaceholder: "Поиск…",
    searchLabel: "Поиск по сайту",
    find: "Найти",
    notifications: "Уведомления",
    register: "Регистрация",
    login: "Войти",
    menu: "Меню",
    skip: "Перейти к содержимому",
    homeAria: "ENDEMION — на главную",
    footerText: "Независимая игровая студия и сообщество игроков.",
    social: "Endemion в соцсетях",
    sections: "Разделы",
    projects: "Проекты",
    documents: "Документы",
    legal: "Правовой центр",
    privacy: "Политика конфиденциальности",
    terms: "Условия использования",
    copyright: "Правообладателям",
    cookies: "Настройки cookie",
    rights: "Все права защищены.",
    langSwitch: "English"
  },
  en: {
    nav: { home: "Home", games: "Games", community: "Community", studio: "Development", about: "About" },
    search: "Search",
    searchPlaceholder: "Search…",
    searchLabel: "Search the site",
    find: "Search",
    notifications: "Notifications",
    register: "Sign up",
    login: "Log in",
    menu: "Menu",
    skip: "Skip to content",
    homeAria: "ENDEMION — home",
    footerText: "An independent game studio and its player community.",
    social: "Endemion on social media",
    sections: "Sections",
    projects: "Projects",
    documents: "Documents",
    legal: "Legal center",
    privacy: "Privacy policy",
    terms: "Terms of use",
    copyright: "Copyright",
    cookies: "Cookie settings",
    rights: "All rights reserved.",
    langSwitch: "Русский"
  }
};

/** Строки выбранного языка */
export function t(lang) {
  return STRINGS[lang] || STRINGS.ru;
}
