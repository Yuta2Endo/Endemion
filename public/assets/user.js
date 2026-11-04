// Публичный профиль участника /users/:username: описание, активность на форуме, достижения, подписка, подписчики, жалоба

import { api, avatar, button, el, errorBox, formatDate, initHeader, link, loginUrl, reportContent, stateBox, toast } from "./app.js";

const root = document.querySelector("#userPage");
const username = document.querySelector("main").dataset.username;

let viewer = null;

function statBox(value, label) {
  const box = el("div", "stat-box");
  box.append(el("strong", null, String(value ?? "—")), el("span", null, label));
  return box;
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
    root.append(stateBox({ icon: "🔒", title: "Профиль скрыт", text: "Участник сделал профиль приватным. Его активность и статистика не видны." }));
    return;
  }

  const stats = el("div", "stat-grid section");
  const followers = statBox(data.stats.followers, "подписчиков");
  followers.querySelector("strong").dataset.followers = "";
  stats.append(statBox(data.stats.topics, "тем"), statBox(data.stats.posts, "ответов"), followers, statBox(data.stats.following, "подписок"));
  root.append(stats);

  const split = el("div", "split section");
  const left = el("div", "stack");
  const right = el("aside", "stack");
  left.append(forumBlock());

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

  right.append(achievements, follows);
  split.append(left, right);
  root.append(split);
}

/** Активность на форуме: последние темы и ответы. Загружается отдельно, сервер учитывает приватность */
function forumBlock() {
  const section = el("section", "panel");
  section.append(el("h2", null, "Форум"));
  const box = el("div", "stack");
  box.append(el("p", "muted small", "Загружаем активность…"));
  section.append(box);
  api(`/api/users/${encodeURIComponent(username)}/forum`).then((result) => {
    if (result.status === 403) return box.replaceChildren(el("p", "muted small", "Участник скрыл свою активность."));
    if (!result.ok) return box.replaceChildren(errorBox(result.data?.error || "Активность не загрузилась."));
    const { topics, posts } = result.data;
    const parts = [];
    if (topics.length) {
      const list = el("div", "stack");
      for (const topic of topics) {
        const row = el("p");
        row.append(link(`/community/thread/${topic.id}`, null, topic.subject), el("span", "muted small", ` · ${formatDate(topic.createdAt)}`));
        list.append(row);
      }
      parts.push(el("h3", null, "Последние темы"), list);
    }
    if (posts.length) {
      const list = el("div", "stack");
      for (const post of posts) {
        const row = el("div");
        const head = el("p");
        head.append(link(`/community/thread/${post.thread.id}#comment-${post.id}`, null, post.thread.subject), el("span", "muted small", ` · ${formatDate(post.createdAt)}`));
        row.append(head, el("p", "muted small", post.spoiler ? "Ответ скрыт под спойлером." : post.excerpt));
        list.append(row);
      }
      parts.push(el("h3", null, "Последние ответы"), list);
    }
    box.replaceChildren(...(parts.length ? parts : [el("p", "muted small", "Тем и ответов пока нет.")]));
  });
  return section;
}

async function init() {
  viewer = await initHeader();
  const result = await api(`/api/users/${encodeURIComponent(username)}`);
  if (result.status === 404) {
    root.replaceChildren(stateBox({ icon: "🔭", title: "Профиль не найден", text: "Возможно, участник сменил имя профиля или удалил аккаунт.", action: { href: "/community#readers", text: "Найти участников" } }));
    return;
  }
  if (!result.ok) {
    root.replaceChildren(errorBox(result.data?.error || "Профиль не загрузился.", init));
    return;
  }
  render(result.data);
}

init();
