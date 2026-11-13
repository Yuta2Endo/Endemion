// Интеграционные тесты платформы: `npm test`. Приложение на временной базе (tests/helpers/app.mjs),
// API проверяется так же, как его вызывает браузер: вход, ответы на форуме, модерация, профили, роли

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createApp, PASSWORD } from "./helpers/app.mjs";

let app;
before(async () => {
  app = await createApp();
});
after(async () => {
  await app.close();
});

/** Новая тема в «Общем обсуждении» от имени user. Возвращает её id */
async function topic(user, subject = "Тема для проверки") {
  const r = await user.call("POST", "/api/threads", { kind: "discussion", subject, body: "Текст темы.", category: "general" });
  assert.equal(r.status, 201, r.text);
  return r.data.thread.id;
}

const reply = (user, threadId, body, extra = {}) =>
  user.call("POST", "/api/comments", { targetType: "thread", targetId: threadId, body, ...extra });

describe("авторизация", () => {
  test("регистрация создаёт профиль ENDEMION ID и сразу входит", async () => {
    const member = await app.user("Анна");
    const me = await member.call("GET", "/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.user.role, "user");
    assert.equal(me.data.user.isAdmin, false);
    assert.match(me.data.user.username, /^[a-zA-Z0-9_]{3,24}$/);
    assert.equal(me.data.stats.topics, 0);
    assert.equal(me.data.stats.posts, 0);
  });

  test("вход, неверный пароль и выход", async () => {
    const member = await app.user("Борис");
    const guest = app.client();
    let r = await guest.call("POST", "/api/auth/login", { email: member.email, password: "wrong-password-1" });
    assert.equal(r.status, 401);
    r = await guest.call("POST", "/api/auth/login", { email: member.email, password: PASSWORD });
    assert.equal(r.status, 200);
    assert.equal((await guest.call("GET", "/api/me")).data.user.id, member.id);
    await guest.call("POST", "/api/auth/logout", {});
    assert.equal((await guest.call("GET", "/api/me")).data.user, null);
  });

  test("проверки регистрации и защита от CSRF", async () => {
    const guest = app.client();
    const email = `x-${Date.now()}@example.com`;
    let r = await guest.call("POST", "/api/auth/register", { name: "Икс", email, password: "short", consent: true });
    assert.equal(r.status, 400);
    r = await guest.call("POST", "/api/auth/register", { name: "Икс", email, password: PASSWORD, consent: false });
    assert.equal(r.status, 400);
    r = await guest.call("POST", "/api/auth/register", { name: "Икс", email, password: PASSWORD, consent: true }, { origin: "https://evil.example" });
    assert.equal(r.status, 403);
  });

  test("приватные данные недоступны гостю", async () => {
    const guest = app.client();
    for (const url of ["/api/notifications", "/api/me/profile", "/api/me/achievements"]) {
      assert.equal((await guest.call("GET", url)).status, 401, url);
    }
  });
});

describe("сообщество", () => {
  test("ответы, ответ на ответ и уведомление автору темы", async () => {
    const author = await app.user("Автор");
    const replier = await app.user("Отвечающий");
    const threadId = await topic(author, "Когда выйдет обновление?");
    let r = await reply(author, threadId, "Кто знает сроки? <script>x</script>");
    assert.equal(r.status, 201);
    const root = r.data.comment;
    r = await reply(replier, threadId, "Смотри devlog.", { parentId: root.id });
    assert.equal(r.status, 201);
    assert.equal(r.data.comment.rootId, root.id);

    const list = await app.client().call("GET", `/api/comments?type=thread&id=${threadId}`);
    assert.equal(list.data.total, 2);
    assert.equal(list.data.comments[0].thread.length, 1);
    // Текст хранится как есть и экранируется при выводе: сервер не превращает его в HTML
    assert.equal(list.data.comments[0].body, "Кто знает сроки? <script>x</script>");
    assert.equal((await app.client().call("GET", `/api/threads/${threadId}`)).data.thread.comments, 2);
    const notices = await author.call("GET", "/api/notifications");
    assert.ok(notices.data.notifications.some((n) => n.kind === "reply"));
  });

  test("комментарии принимаются только к темам форума", async () => {
    const member = await app.user("Любопытный");
    for (const targetType of ["title", "collection", "anime", "entry_review"]) {
      const r = await member.call("POST", "/api/comments", { targetType, targetId: 1, body: "Привет" });
      assert.equal(r.status, 400, targetType);
    }
  });

  test("реакции, правка своего и запрет на чужое", async () => {
    const author = await app.user("Пишущий");
    const other = await app.user("Другой");
    const threadId = await topic(author);
    const { data } = await reply(author, threadId, "Первое впечатление от Endemion Life.");
    const commentId = data.comment.id;
    let r = await other.call("PUT", `/api/comments/${commentId}/reactions`, { kind: "fire" });
    assert.deepEqual(r.data.reactions, { fire: 1 });
    r = await other.call("PUT", `/api/comments/${commentId}/reactions`, { kind: "poop" });
    assert.equal(r.status, 400);
    assert.equal((await other.call("PATCH", `/api/comments/${commentId}`, { body: "взлом" })).status, 403);
    assert.equal((await other.call("DELETE", `/api/comments/${commentId}`)).status, 403);
    r = await author.call("PATCH", `/api/comments/${commentId}`, { body: "Второе впечатление." });
    assert.equal(r.data.comment.body, "Второе впечатление.");
    assert.ok(r.data.comment.editedAt);
  });

  test("защита от спама: ссылки, повтор, частота", async () => {
    const spammer = await app.user("Спамер");
    const threadId = await topic(spammer);
    const links = "https://a.example https://b.example https://c.example https://d.example";
    let r = await reply(spammer, threadId, links);
    assert.equal(r.status, 400);
    await reply(spammer, threadId, "Первый");
    r = await reply(spammer, threadId, "Первый");
    assert.equal(r.status, 409);
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await reply(spammer, threadId, `Сообщение ${i}`)).status);
    assert.ok(statuses.includes(429), `ожидался 429: ${statuses}`);
  });

  test("модератор удаляет ответ, ответы на него остаются, автор заглушён", async () => {
    const author = await app.user("Грубиян");
    const replier = await app.user("Вежливый");
    const reporter = await app.user("Жалобщик");
    const moderator = await app.user("Модератор", "moderator");
    const threadId = await topic(replier, "Обсуждение правил");
    const root = (await reply(author, threadId, "Грубость")).data.comment;
    await reply(replier, threadId, "Не надо так.", { parentId: root.id });

    let r = await reporter.call("POST", "/api/reports", { targetType: "comment", targetId: root.id, reason: "abuse" });
    assert.equal(r.status, 201);
    r = await reporter.call("POST", "/api/reports", { targetType: "comment", targetId: root.id, reason: "abuse" });
    assert.equal(r.data.duplicate, true);
    // Третья жалоба от разных людей будит модераторов уведомлением
    const second = await app.user("Второй жалобщик");
    const third = await app.user("Третий жалобщик");
    assert.equal((await second.call("POST", "/api/reports", { targetType: "comment", targetId: root.id, reason: "abuse" })).status, 201);
    assert.equal((await third.call("POST", "/api/reports", { targetType: "comment", targetId: root.id, reason: "abuse" })).status, 201);
    const inbox = await moderator.call("GET", "/api/notifications");
    assert.ok(
      inbox.data.notifications.some((item) => item.kind === "moderation" && item.link === "/admin"),
      "модератор должен узнать о третьей жалобе"
    );
    // Жалобы на контент удалённых разделов не принимаются
    assert.equal((await reporter.call("POST", "/api/reports", { targetType: "collection", targetId: 1, reason: "spam" })).status, 400);
    const queue = await moderator.call("GET", "/api/moderation/reports");
    assert.ok(queue.data.groups.some((group) => group.targetType === "comment" && group.targetId === root.id));

    r = await moderator.call("POST", "/api/moderation/actions", {
      targetType: "comment", targetId: root.id, action: "remove", reason: "Оскорбления", muteDays: 3
    });
    assert.equal(r.status, 200);
    const list = await app.client().call("GET", `/api/comments?type=thread&id=${threadId}`);
    const shown = list.data.comments.find((comment) => comment.id === root.id);
    assert.equal(shown.deleted, true);
    assert.equal(shown.body, "");
    assert.equal(shown.thread.length, 1);
    r = await reply(author, threadId, "Снова я");
    assert.equal(r.status, 403);
    const log = await moderator.call("GET", "/api/moderation/log");
    assert.ok(log.data.entries.some((entry) => entry.action === "comment.remove"));
  });

  test("теория даёт достижение и попадает в ленту теорий", async () => {
    const member = await app.user("Теоретик");
    let r = await member.call("POST", "/api/threads", { kind: "theory", subject: "Шестой мир связан с первым", body: "Аргументы.", spoiler: true });
    assert.equal(r.status, 201);
    assert.ok(r.data.achievements.includes("theorist"));
    assert.equal(r.data.thread.title, undefined, "темы больше не привязываются к тайтлам");
    const threadId = r.data.thread.id;
    r = await app.client().call("GET", "/api/threads?kind=theory");
    assert.ok(r.data.threads.some((thread) => thread.id === threadId));
    const achievements = (await member.call("GET", "/api/me/achievements")).data.achievements;
    assert.deepEqual(achievements.map((item) => item.code).sort(), ["followed_5", "theorist", "voice_10"]);
  });

  test("подписки и приватный профиль", async () => {
    const star = await app.user("Звезда");
    const fan = await app.user("Фанат");
    const username = (await star.call("GET", "/api/me")).data.user.username;
    assert.equal((await fan.call("PUT", `/api/users/${username}/follow`)).status, 200);
    let r = await app.client().call("GET", `/api/users/${username}`);
    assert.equal(r.data.stats.followers, 1);
    assert.equal((await star.call("PUT", `/api/users/${username}/follow`)).status, 409);
    const notices = await star.call("GET", "/api/notifications");
    assert.ok(notices.data.notifications.some((n) => n.kind === "follow"));

    await star.call("PATCH", "/api/me/profile", { isPublic: false });
    r = await app.client().call("GET", `/api/users/${username}`);
    assert.equal(r.data.private, true);
    assert.equal(r.data.stats, undefined);
    assert.equal((await app.client().call("GET", `/api/users/${username}/forum`)).status, 403);
    r = await star.call("GET", `/api/users/${username}`);
    assert.equal(r.data.private, false, "владелец видит свой профиль");
  });

  test("имя профиля проверяется и не занимается дважды", async () => {
    const a = await app.user("Первый");
    const b = await app.user("Второй");
    assert.equal((await a.call("PATCH", "/api/me/profile", { username: "night_player" })).status, 200);
    assert.equal((await b.call("PATCH", "/api/me/profile", { username: "NIGHT_PLAYER" })).status, 409);
    assert.equal((await b.call("PATCH", "/api/me/profile", { username: "ночь" })).status, 400);
    assert.equal((await b.call("PATCH", "/api/me/profile", { username: "admin" })).status, 409);
  });

  test("удаление аккаунта оставляет ответы других людей", async () => {
    const leaver = await app.user("Уходящий");
    const stayer = await app.user("Остающийся");
    const threadId = await topic(stayer, "Прощальная тема");
    const root = (await reply(leaver, threadId, "Пока!")).data.comment;
    await reply(stayer, threadId, "Удачи", { parentId: root.id });
    assert.equal((await leaver.call("DELETE", "/api/me", { password: PASSWORD })).status, 200);
    const list = await app.client().call("GET", `/api/comments?type=thread&id=${threadId}`);
    const shown = list.data.comments.find((comment) => comment.id === root.id);
    assert.equal(shown.deleted, true);
    assert.equal(shown.author, null);
    assert.equal(shown.thread[0].body, "Удачи");
  });
});

describe("роли и админка", () => {
  test("права проверяются на сервере для каждой роли", async () => {
    const member = await app.user("Участник");
    const moderator = await app.user("Модератор", "moderator");
    const admin = await app.user("Админ", "admin");
    const guest = app.client();
    for (const url of ["/api/admin/stats", "/api/admin/platform-stats", "/api/admin/users", "/api/admin/audit"]) {
      assert.equal((await guest.call("GET", url)).status, 401, url);
      assert.equal((await member.call("GET", url)).status, 403, url);
      assert.equal((await moderator.call("GET", url)).status, 403, url);
      assert.equal((await admin.call("GET", url)).status, 200, url);
    }
    assert.equal((await member.call("GET", "/api/moderation/reports")).status, 403);
    assert.equal((await moderator.call("GET", "/api/moderation/reports")).status, 200);
  });

  test("сводка админки считает игры, публикации и форум", async () => {
    const admin = await app.user("Сводчик", "admin");
    const stats = await admin.call("GET", "/api/admin/stats");
    assert.equal(stats.data.content.games, 5);
    assert.equal(stats.data.content.publishedGames, 5);
    const community = await admin.call("GET", "/api/admin/platform-stats");
    assert.equal(typeof community.data.threads, "number");
    assert.equal(typeof community.data.reports_open, "number");
  });

  test("роль выдаёт администратор с паролем, свою роль сменить нельзя", async () => {
    const admin = await app.user("Главный", "admin");
    const member = await app.user("Будущий модератор");
    let r = await admin.call("PUT", `/api/admin/users/${member.id}/role`, { role: "moderator", password: "wrong-password-1" });
    assert.equal(r.status, 403);
    r = await admin.call("PUT", `/api/admin/users/${member.id}/role`, { role: "moderator", password: PASSWORD });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, "moderator");
    assert.equal((await member.call("GET", "/api/me")).data.user.isModerator, true);
    r = await admin.call("PUT", `/api/admin/users/${admin.id}/role`, { role: "user", password: PASSWORD });
    assert.equal(r.status, 409);
  });

  test("тестовый администратор из seed", async () => {
    const id = await app.seedAdmin("seed-admin@example.com", "seed-admin-pass-1");
    const row = await app.db.prepare("SELECT role FROM users WHERE id = ?").bind(id).first();
    assert.equal(row.role, "admin");
    const guest = app.client();
    const r = await guest.call("POST", "/api/auth/login", { email: "seed-admin@example.com", password: "seed-admin-pass-1" });
    assert.equal(r.status, 200);
    assert.equal((await guest.call("GET", "/api/admin/users")).status, 200);
  });
});
