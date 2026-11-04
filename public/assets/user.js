// Публичный профиль читателя /users/:username: описание, статистика, достижения, полка, подписка, подписчики, жалоба

import {
  api, avatar, button, el, errorBox, formatDate, getLibrary, getMe, initHeader, link, loginUrl, remoteImage, reportContent,
  stateBox, STATUS_LABELS, titleCard, toast, toggleFavorite
} from "./app.js";
import { entryCardNode, LIST_STATUSES } from "./ency-lib.js";

const root = document.querySelector("#userPage");
const username = document.querySelector("main").dataset.username;

let viewer = null;
let library = new Map();

function statBox(value, label) {
  const box = el("div", "stat-box");
  box.append(el("strong", null, String(value ?? "—")), el("span", null, label));
  return box;
}

function cards(items) {
  return items.map((item) => titleCard(item.title, {
    library: viewer ? library.get(item.title.id) : { chapter: item.chapter, status: item.status },
    onFavorite: toggleFavorite
  }));
}

function followButton(data) {
  let following = data.following;
  const node = button("", following ? "ghost-btn" : "primary-btn", async () => {
    if (!viewer) return (location.href = loginUrl());
    node.disabled = true;
    const result = await api(`/api/users/${encodeURIComponent(username)}/follow`, { method: following ? "DELETE" : "PUT" });
    node.disabled = false;
    if (!result.ok) return toast(result.data?.error || "Не удалось.");
    following = result.data.following;
    update();
    const counter = root.querySelector("[data-followers]");
    if (counter) counter.textContent = String(Number(counter.textContent) + (following ? 1 : -1));
  });
  const update = () => {
    node.textContent = following ? "✓ Вы подписаны" : "＋ Подписаться";
    node.className = following ? "ghost-btn" : "primary-btn";
    node.setAttribute("aria-pressed", String(following));
  };
  update();
  return node;
}

async function showFollows(kind) {
  const result = await api(`/api/users/${encodeURIComponent(username)}/follows?kind=${kind}`);
  const box = root.querySelector("#followsBox");
  if (!result.ok) return box.replaceChildren(errorBox(result.data?.error || "Не загрузилось."));
  box.replaceChildren(el("h2", null, kind === "followers" ? "Подписчики" : "Подписки"));
  if (!result.data.users.length) return box.append(el("p", "muted small", "Пока никого."));
  const list = el("div", "stack");
  for (const user of result.data.users) {
    const row = el("a", "user-chip");
    row.href = `/users/${encodeURIComponent(user.username)}`;
    row.append(avatar(user), el("strong", null, user.name), el("small", null, `@${user.username}`));
    list.append(row);
  }
  box.append(list);
}

function render(data) {
  const { profile } = data;
  document.title = `${profile.name} (@${profile.username}) | ENDEMION`;
  root.removeAttribute("aria-busy");

  const hero = el("section", "profile-hero");
  const info = el("div");
  const heading = el("h1", null, profile.name);
  if (profile.role !== "user") heading.append(el("span", "role-badge", profile.role === "admin" ? "админ" : "модератор"));
  info.append(heading, el("p", "profile-handle", `@${profile.username}`));
  if (profile.bio) info.append(el("p", "profile-bio", profile.bio));
  info.append(el("p", "muted small", `С нами с ${formatDate(profile.createdAt)}`));
  const buttons = el("div", "profile-buttons");
  if (data.own) {
    buttons.append(link("/profile#settings", "ghost-btn", "Редактировать профиль"));
  } else {
    buttons.append(followButton(data));
    if (viewer) buttons.append(button("Пожаловаться", "ghost-btn", () => reportContent("user", profile.id)));
  }
  hero.append(avatar(profile, "avatar-lg"), info, buttons);
  root.replaceChildren(hero);

  if (data.private) {
    root.append(stateBox({ icon: "🔒", title: "Профиль скрыт", text: "Читатель сделал профиль приватным. Его полка и статистика не видны." }));
    return;
  }

  const stats = el("div", "stat-grid section");
  const followers = statBox(data.stats.followers, "подписчиков");
  followers.querySelector("strong").dataset.followers = "";
  stats.append(
    statBox(data.stats.chapters, "глав прочитано"),
    statBox(data.stats.completed, "тайтлов дочитано"),
    statBox(data.stats.reading, "читает сейчас"),
    statBox(data.stats.reviews, "оценок"),
    statBox(data.stats.comments, "комментариев"),
    followers,
    statBox(data.stats.following, "подписок")
  );
  root.append(stats);

  root.append(forumBlock());
  root.append(encyclopediaBlock());

  const split = el("div", "split section");
  const left = el("div", "stack");
  const right = el("aside", "stack");

  if (data.libraryHidden) {
    left.append(stateBox({ icon: "📚", text: "Читатель скрыл свою полку." }));
  } else {
    for (const [key, label, items] of [["reading", "Читает сейчас", data.reading], ["favorites", "Избранное", data.favorites]]) {
      const section = el("section");
      section.append(el("h2", "section-head", label));
      const grid = el("div", "cards");
      grid.append(...(items.length ? cards(items) : [el("p", "muted small", "Пусто.")]));
      section.append(grid);
      left.append(section);
      section.dataset.shelf = key;
    }
    const shelf = el("section");
    const chips = el("div", "chips");
    const grid = el("div", "cards section");
    const load = async (status) => {
      chips.querySelectorAll("button").forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.status === status)));
      const result = await api(`/api/users/${encodeURIComponent(username)}/library?status=${status}`);
      if (!result.ok) return grid.replaceChildren(errorBox(result.data?.error || "Полка не загрузилась."));
      grid.replaceChildren(...(result.data.items.length ? cards(result.data.items) : [el("p", "muted small", "Пусто.")]));
    };
    for (const [status, label] of Object.entries(STATUS_LABELS)) {
      const chip = button(label, "chip", () => load(status), { pressed: false });
      chip.dataset.status = status;
      chips.append(chip);
    }
    shelf.append(el("h2", "section-head", "Вся полка"), chips, grid);
    left.append(shelf);
    load("completed");
  }

  const genres = el("section", "panel");
  genres.append(el("h2", null, "Любимые жанры"));
  const chips = el("div", "chips");
  const names = [...new Set([...data.genres, ...data.stats.topGenres.map((genre) => genre.name)])].slice(0, 10);
  chips.append(...(names.length ? names.map((name) => link(`/catalog?genre=${encodeURIComponent(name)}`, "tag", name)) : [el("p", "muted small", "Пока не понятно.")]));
  genres.append(chips);

  const achievements = el("section", "panel");
  achievements.append(el("h2", null, `Достижения · ${data.achievements.length} из ${data.achievementsTotal}`));
  const grid = el("div", "achievements");
  grid.append(...(data.achievements.length ? data.achievements.map((item) => {
    const node = el("div", "achievement");
    node.append(el("b", null, item.icon), el("strong", null, item.name), el("small", null, item.description));
    return node;
  }) : [el("p", "muted small", "Пока нет.")]));
  achievements.append(grid);

  const follows = el("section", "panel");
  follows.id = "followsBox";
  const followChips = el("div", "chips");
  followChips.append(button("Подписчики", "chip", () => showFollows("followers")), button("Подписки", "chip", () => showFollows("following")));
  follows.append(el("h2", null, "Связи"), followChips);

  const collections = el("section", "panel");
  collections.append(el("h2", null, "Подборки"));
  api(`/api/collections?user=${encodeURIComponent(username)}`).then((result) => {
    const list = result.ok ? result.data.collections : [];
    if (!list.length) return collections.append(el("p", "muted small", "Публичных подборок нет."));
    for (const collection of list) {
      const row = el("p");
      row.append(link(`/collection/${collection.id}`, null, collection.name), el("span", "muted small", ` · ${collection.size} тайтлов`));
      collections.append(row);
    }
  });

  right.append(genres, achievements, collections, follows);
  split.append(left, right);
  root.append(split);
}

const FAVORITE_PATHS = { anime: "/anime", manga: "/manga", character: "/characters", person: "/people" };

/** Списки энциклопедии: статистика аниме и манги, последние записи и избранное. Загружается отдельно */
function encyclopediaBlock() {
  const section = el("section", "section");
  section.append(el("h2", "section-head", "Аниме и манга"));
  const box = el("div");
  box.append(el("p", "muted small", "Загружаем списки…"));
  section.append(box);
  api(`/api/users/${encodeURIComponent(username)}/encyclopedia`).then(async (result) => {
    if (result.status === 403) return box.replaceChildren(el("p", "muted small", "Пользователь скрыл свои списки."));
    if (!result.ok) return box.replaceChildren(errorBox(result.data?.error || "Списки не загрузились."));
    const { stats, favorites } = result.data;
    const parts = [];
    for (const kind of ["anime", "manga"]) {
      const s = stats[kind];
      if (!s.total) continue;
      const grid = el("div", "stat-grid");
      grid.append(statBox(s.total, kind === "anime" ? "аниме в списке" : "манги в списке"));
      for (const [key, label] of Object.entries(LIST_STATUSES[kind])) if (s.statuses[key]) grid.append(statBox(s.statuses[key], label.toLowerCase()));
      grid.append(statBox(s.units, kind === "anime" ? "эпизодов" : "глав"));
      if (kind === "anime") grid.append(statBox(s.hours, "часов"));
      if (s.meanScore) grid.append(statBox(s.meanScore, "средняя оценка"));
      const recent = await api(`/api/users/${encodeURIComponent(username)}/mylist?kind=${kind}`);
      const rail = el("div", "e-rail");
      if (recent.ok) {
        rail.append(...recent.data.items.slice(0, 12).map((item) => entryCardNode(item.entry, {
          extra: el("p", "e-role", `${LIST_STATUSES[kind][item.status]}${item.score ? ` · ★ ${item.score}` : ""}`)
        })));
      }
      parts.push(el("p", "filter-sub", kind === "anime" ? "Аниме" : "Манга"), grid, rail);
    }
    if (favorites.length) {
      const grid = el("div", "fav-grid");
      for (const item of favorites.slice(0, 18)) {
        const card = el("article", "p-card");
        const photo = link(`${FAVORITE_PATHS[item.type]}/${item.id}`, "p-photo", null);
        photo.tabIndex = -1;
        photo.setAttribute("aria-hidden", "true");
        photo.append(remoteImage(item.image, ""));
        const name = el("h3", "p-name");
        name.append(link(`${FAVORITE_PATHS[item.type]}/${item.id}`, null, item.name));
        card.append(photo, name);
        grid.append(card);
      }
      parts.push(el("p", "filter-sub", "Избранное"), grid);
    }
    box.replaceChildren(...(parts.length ? parts : [el("p", "muted small", "Списки пока пусты.")]));
  });
  return section;
}

async function init() {
  viewer = await initHeader();
  if (viewer) library = await getLibrary();
  await getMe();
  const result = await api(`/api/users/${encodeURIComponent(username)}`);
  if (result.status === 404) {
    root.replaceChildren(stateBox({ icon: "🔭", title: "Профиль не найден", text: "Возможно, читатель сменил имя профиля или удалил аккаунт.", action: { href: "/community#readers", text: "Найти читателей" } }));
    return;
  }
  if (!result.ok) {
    root.replaceChildren(errorBox(result.data?.error || "Профиль не загрузился.", init));
    return;
  }
  render(result.data);
}

init();

/** Активность на форуме: число тем и ответов, последние темы и ответы. Загружается отдельно, сервер учитывает приватность */
function forumBlock() {
  const section = el("section", "section");
  section.append(el("h2", "section-head", "Форум"));
  const box = el("div");
  box.append(el("p", "muted small", "Загружаем активность…"));
  section.append(box);
  api(`/api/users/${encodeURIComponent(username)}/forum`).then((result) => {
    if (result.status === 403) return box.replaceChildren(el("p", "muted small", "Пользователь скрыл свою активность."));
    if (!result.ok) return box.replaceChildren(errorBox(result.data?.error || "Активность не загрузилась."));
    const { topicsCount, postsCount, topics, posts } = result.data;
    const stats = el("div", "stat-grid");
    stats.append(statBox(topicsCount, "тем"), statBox(postsCount, "ответов"));
    const parts = [stats];
    if (topics.length) {
      const list = el("div", "stack section");
      for (const topic of topics) {
        const row = el("p");
        row.append(link(`/community/thread/${topic.id}`, null, topic.subject), el("span", "muted small", ` · ${formatDate(topic.createdAt)}`));
        list.append(row);
      }
      parts.push(el("p", "filter-sub", "Последние темы"), list);
    }
    if (posts.length) {
      const list = el("div", "stack section");
      for (const post of posts) {
        const row = el("div");
        const head = el("p");
        head.append(link(`/community/thread/${post.thread.id}#comment-${post.id}`, null, post.thread.subject), el("span", "muted small", ` · ${formatDate(post.createdAt)}`));
        row.append(head, el("p", "muted small", post.spoiler ? "Ответ скрыт под спойлером." : post.excerpt));
        list.append(row);
      }
      parts.push(el("p", "filter-sub", "Последние ответы"), list);
    }
    box.replaceChildren(...parts);
  });
  return section;
}
