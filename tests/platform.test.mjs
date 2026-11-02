// Интеграционные тесты платформы: `npm test`. Каждый блок поднимает приложение на временной базе с демо-каталогом
// (tests/helpers/app.mjs) и проверяет API так же, как его вызывает браузер

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

describe("авторизация", () => {
  test("регистрация создаёт профиль ENDEMION ID и сразу входит", async () => {
    const reader = await app.user("Анна");
    const me = await reader.call("GET", "/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.user.role, "user");
    assert.equal(me.data.user.isAdmin, false);
    assert.match(me.data.user.username, /^[a-zA-Z0-9_]{3,24}$/);
    assert.equal(me.data.stats.library, 0);
  });

  test("вход, неверный пароль и выход", async () => {
    const reader = await app.user("Борис");
    const guest = app.client();
    let r = await guest.call("POST", "/api/auth/login", { email: reader.email, password: "wrong-password-1" });
    assert.equal(r.status, 401);
    r = await guest.call("POST", "/api/auth/login", { email: reader.email, password: PASSWORD });
    assert.equal(r.status, 200);
    assert.equal((await guest.call("GET", "/api/me")).data.user.id, reader.id);
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
    for (const url of ["/api/library", "/api/notifications", "/api/continue", "/api/me/profile", "/api/titles?tab=favorites"]) {
      assert.equal((await guest.call("GET", url)).status, 401, url);
    }
  });
});

describe("каталог, фильтры и поиск", () => {
  test("каталог из базы с постраничной выдачей без повторов", async () => {
    const guest = app.client();
    const first = await guest.call("GET", "/api/titles?limit=10&offset=0&sort=title");
    const second = await guest.call("GET", "/api/titles?limit=10&offset=10&sort=title");
    assert.equal(first.data.total, 24);
    assert.equal(first.data.titles.length, 10);
    const ids = new Set([...first.data.titles, ...second.data.titles].map((t) => t.id));
    assert.equal(ids.size, 20);
  });

  test("фильтры по типу, статусу и жанру работают вместе", async () => {
    const guest = app.client();
    let r = await guest.call("GET", "/api/titles?type=manga&limit=100");
    assert.ok(r.data.total > 0 && r.data.titles.every((t) => t.type === "manga"));
    r = await guest.call("GET", "/api/titles?status=completed&limit=100");
    assert.ok(r.data.total > 0 && r.data.titles.every((t) => t.status === "completed"));
    r = await guest.call("GET", `/api/titles?genre=${encodeURIComponent("Ужасы")}&type=manhwa&limit=100`);
    assert.deepEqual(r.data.titles.map((t) => t.title), ["Последний свет Нового Пусана"]);
    r = await guest.call("GET", "/api/titles?type=comics");
    assert.equal(r.status, 400);
  });

  test("сортировки: новизна, рейтинг, по названию", async () => {
    const guest = app.client();
    const fresh = (await guest.call("GET", "/api/titles?sort=new&limit=100")).data.titles;
    assert.ok(fresh.every((t, i) => i === 0 || fresh[i - 1].createdAt >= t.createdAt));
    const rated = (await guest.call("GET", "/api/titles?sort=rating&limit=100")).data.titles;
    assert.ok(rated.every((t, i) => i === 0 || rated[i - 1].rating >= t.rating));
    assert.equal((await guest.call("GET", "/api/titles?sort=bogus")).status, 400);
  });

  test("поиск по названию, автору и жанру", async () => {
    const guest = app.client();
    let r = await guest.call("GET", `/api/titles?q=${encodeURIComponent("ПЕПЕЛ")}`);
    assert.ok(r.data.titles.some((t) => t.title === "Пепел девятой луны"));
    r = await guest.call("GET", `/api/titles?q=${encodeURIComponent("Лин Сяо")}&field=author`);
    assert.deepEqual(r.data.titles.map((t) => t.author).filter((a) => a !== "Лин Сяо"), []);
    assert.equal(r.data.total, 2);
    r = await guest.call("GET", `/api/titles?q=${encodeURIComponent("Лин Сяо")}&field=title`);
    assert.equal(r.data.total, 0);
    r = await guest.call("GET", `/api/titles?q=${encodeURIComponent("боевые")}&field=genre`);
    assert.ok(r.data.total >= 3 && r.data.titles.every((t) => t.genres.includes("Боевые искусства")));
    // «ё» и «е» ищутся одинаково, % ищется как символ, а не как шаблон
    r = await guest.call("GET", `/api/titles?q=${encodeURIComponent("%")}`);
    assert.equal(r.data.total, 0);
  });

  test("число тайтлов по типам и жанрам для фильтров", async () => {
    const r = await app.client().call("GET", "/api/titles?facets=1&limit=1");
    const { typeCounts, genres, statusCounts } = r.data.facets;
    assert.equal(typeCounts.manga + typeCounts.manhwa + typeCounts.manhua, 24);
    assert.equal(statusCounts.ongoing + statusCounts.completed, 24);
    assert.ok(genres.includes("Фэнтези"));
  });

  test("рейтинг читателей считается только по оценкам людей", async () => {
    const id = await app.titleByName("Кухня у старого храма");
    let title = (await app.client().call("GET", `/api/titles/${id}`)).data.title;
    assert.equal(title.readerRating, null);
    assert.equal(title.readerVotes, 0);
    const a = await app.user("Оценщик");
    const b = await app.user("Оценщица");
    assert.equal((await a.call("PUT", `/api/titles/${id}/reviews`, { score: 9 })).status, 200);
    assert.equal((await b.call("PUT", `/api/titles/${id}/reviews`, { score: 6, body: "Мило, но медленно." })).status, 200);
    // Повторная оценка заменяет прежнюю, а не добавляет голос
    await a.call("PUT", `/api/titles/${id}/reviews`, { score: 10 });
    title = (await app.client().call("GET", `/api/titles/${id}`)).data.title;
    assert.equal(title.readerVotes, 2);
    assert.equal(title.readerRating, 8);
    const reviews = (await app.client().call("GET", `/api/titles/${id}/reviews`)).data;
    assert.equal(reviews.total, 1, "в списке только отзывы с текстом");
    assert.equal(reviews.summary.distribution[10], 1);
    assert.equal((await a.call("PUT", `/api/titles/${id}/reviews`, { score: 11 })).status, 400);
  });
});

describe("библиотека, прогресс и избранное", () => {
  test("отмеченная глава делает тайтл «Читаю», прогресс сохраняется в базе", async () => {
    const reader = await app.user("Чтец");
    const id = await app.titleByName("Хроники Шестых Врат");
    let r = await reader.call("PUT", `/api/library/${id}`, { chapter: 5 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.item, { titleId: id, favorite: false, status: "reading", chapter: 5 });
    r = await reader.call("PUT", `/api/library/${id}`, { chapter: 999 });
    assert.equal(r.status, 400);
    r = await reader.call("PUT", `/api/positions/${id}`, { chapter: 6, page: 3 });
    assert.equal(r.status, 200);

    const list = await reader.call("GET", "/api/library");
    assert.equal(list.data.items.find((item) => item.titleId === id).chapter, 5);
    const cont = await reader.call("GET", "/api/continue");
    const item = cont.data.items.find((entry) => entry.title.id === id);
    assert.deepEqual(item.position, { chapter: 6, page: 3 });
    assert.equal(item.next, 6);
    assert.equal(item.unread, item.title.chapters - 5);
  });

  test("дочитанный завершённый тайтл становится «Прочитано», статус «Отложено» работает", async () => {
    const reader = await app.user("Финишер");
    const id = await app.titleByName("Пепел девятой луны");
    const title = (await reader.call("GET", `/api/titles/${id}`)).data.title;
    let r = await reader.call("PUT", `/api/library/${id}`, { chapter: title.chapters });
    assert.equal(r.data.item.status, "completed");
    assert.ok(r.data.achievements.includes("finisher_1"));
    r = await reader.call("PUT", `/api/library/${id}`, { status: "on_hold" });
    assert.equal(r.data.item.status, "on_hold");
    r = await reader.call("PUT", `/api/library/${id}`, { status: "abandoned" });
    assert.equal(r.status, 400);
  });

  test("избранное и полки по статусам", async () => {
    const reader = await app.user("Коллекционер");
    const id = await app.titleByName("Тетрадь последнего лета");
    await reader.call("PUT", `/api/library/${id}`, { favorite: true });
    let r = await reader.call("GET", "/api/titles?tab=favorites");
    assert.deepEqual(r.data.titles.map((t) => t.id), [id]);
    await reader.call("PUT", `/api/library/${id}`, { status: "planned" });
    r = await reader.call("GET", "/api/titles?tab=planned");
    assert.deepEqual(r.data.titles.map((t) => t.id), [id]);
    await reader.call("PUT", `/api/library/${id}`, { favorite: false, status: null });
    assert.equal((await reader.call("GET", "/api/library")).data.items.length, 0, "пустая запись удаляется");
  });

  test("уведомление о новой главе приходит тем, у кого тайтл на полке", async () => {
    const reader = await app.user("Подписчик");
    const quitter = await app.user("Бросивший");
    const admin = await app.user("Админ", "admin");
    const id = await app.titleByName("Обещание у моря");
    await reader.call("PUT", `/api/library/${id}`, { status: "reading" });
    await quitter.call("PUT", `/api/library/${id}`, { status: "dropped" });
    const r = await admin.call("POST", `/api/admin/titles/${id}/chapters`, { sideStory: false });
    assert.equal(r.status, 201);
    // Кроме главы, у читателя может быть уведомление о достижении «Первая полка»: считаем только главы
    const chapters = (client) => client.call("GET", "/api/notifications")
      .then((res) => res.data.notifications.filter((n) => n.kind === "chapter"));
    const mine = await chapters(reader);
    assert.equal(mine.length, 1);
    assert.match(mine[0].text, /Обещание у моря/);
    assert.equal(mine[0].link, `/read/${id}/${r.data.chapter.number}`);
    assert.equal((await chapters(quitter)).length, 0);
    await reader.call("POST", "/api/notifications", { all: true });
    assert.equal((await reader.call("GET", "/api/notifications/count")).data.unread, 0);
  });

  test("история просмотра и календарь", async () => {
    const reader = await app.user("Зритель");
    const id = await app.titleByName("Ракетка и шторм");
    await reader.call("POST", `/api/titles/${id}/view`, {});
    const history = await reader.call("GET", "/api/me/history");
    assert.equal(history.data.items[0].title.id, id);
    const calendar = await app.client().call("GET", "/api/calendar");
    assert.equal(calendar.data.week.length, 7);
    assert.ok(calendar.data.recent.length > 0);
  });
});

describe("Nexus и Oracle", () => {
  test("Nexus показывает связи с объяснением", async () => {
    const id = await app.titleByName("Хроники Шестых Врат");
    const r = await app.client().call("GET", `/api/nexus/${id}`);
    assert.equal(r.status, 200);
    const { graph } = r.data;
    assert.equal(graph.center, id);
    assert.ok(graph.nodes.length > 3);
    const edges = graph.edges.filter((edge) => edge.source === id || edge.target === id);
    assert.ok(edges.length > 0 && edges.every((edge) => edge.reasons.length > 0));
    // Связь из админки (тот же мир) и общий автор — самая сильная
    const related = await app.client().call("GET", `/api/titles/${id}/related?limit=1`);
    assert.equal(related.data.items[0].title.title, "Рыцарь, которого не призывали");
    assert.ok(related.data.items[0].reasons.some((reason) => reason.kind === "author"));
  });

  test("Oracle выдаёт мрачные истории по тегам и объясняет почему", async () => {
    const r = await app.client().call("GET", "/api/oracle/dark?limit=5");
    assert.equal(r.status, 200);
    assert.ok(r.data.items.length >= 3);
    for (const item of r.data.items) assert.ok(item.reasons.some((reason) => reason.kind === "mood"));
    const top = r.data.items.slice(0, 3).map((item) => item.title.title);
    assert.ok(top.includes("Последний свет Нового Пусана"));
  });

  test("«похожее» требует тайтл и не предлагает его самого", async () => {
    const guest = app.client();
    assert.equal((await guest.call("GET", "/api/oracle/similar")).status, 400);
    const id = await app.titleByName("Код небесного дракона");
    const r = await guest.call("GET", `/api/oracle/similar?title=${id}`);
    assert.ok(r.data.items.length > 0);
    assert.ok(r.data.items.every((item) => item.title.id !== id));
    // Первой идёт «Песнь ледяного перевала»: тот же автор и связь «тот же мир» из админки.
    // Совпадение по культивации, Древнему Китаю и мести тоже должно попасть наверх
    assert.equal(r.data.items[0].title.title, "Песнь ледяного перевала");
    assert.ok(r.data.items[0].reasons.some((reason) => reason.kind === "relation"));
    const top = r.data.items.slice(0, 3).map((item) => item.title.title);
    assert.ok(top.includes("Вторая жизнь мастера клинка"), top.join(", "));
  });

  test("рекомендации учитывают вкус и не повторяют полку", async () => {
    const reader = await app.user("Романтик");
    const love = await app.titleByName("Чайный дом на Нефритовой улице");
    await reader.call("PUT", `/api/library/${love}`, { favorite: true, status: "completed" });
    await reader.call("PUT", "/api/me/genres", { genres: ["Романтика"] });
    const r = await reader.call("GET", "/api/oracle/romance");
    assert.equal(r.data.personalized, true);
    assert.ok(r.data.items.every((item) => item.title.id !== love));
    assert.ok(r.data.items.some((item) => item.reasons.some((reason) => reason.kind === "taste")));
    const home = await reader.call("GET", "/api/home");
    assert.equal(home.data.forYou.personalized, true);
    assert.ok(home.data.forYou.items.length > 0);
  });

  test("неизвестное настроение — 404", async () => {
    assert.equal((await app.client().call("GET", "/api/oracle/sleepy")).status, 404);
  });
});

describe("сообщество", () => {
  test("комментарии, ответы и уведомление об ответе", async () => {
    const author = await app.user("Автор");
    const replier = await app.user("Отвечающий");
    const id = await app.titleByName("Шахматист теневого двора");
    let r = await author.call("POST", "/api/comments", { targetType: "title", targetId: id, body: "Кто такой Ферзь? <script>x</script>" });
    assert.equal(r.status, 201);
    const root = r.data.comment;
    r = await replier.call("POST", "/api/comments", { targetType: "title", targetId: id, body: "Думаю, учитель.", parentId: root.id });
    assert.equal(r.status, 201);
    assert.equal(r.data.comment.rootId, root.id);

    const list = await app.client().call("GET", `/api/comments?type=title&id=${id}`);
    assert.equal(list.data.total, 2);
    assert.equal(list.data.comments[0].thread.length, 1);
    // Текст хранится как есть и экранируется при выводе: сервер не превращает его в HTML
    assert.equal(list.data.comments[0].body, "Кто такой Ферзь? <script>x</script>");
    const notices = await author.call("GET", "/api/notifications");
    assert.ok(notices.data.notifications.some((n) => n.kind === "reply"));
  });

  test("реакции, правка своего и запрет на чужое", async () => {
    const author = await app.user("Пишущий");
    const other = await app.user("Другой");
    const id = await app.titleByName("Кухня у старого храма");
    const { data } = await author.call("POST", "/api/comments", { targetType: "title", targetId: id, body: "Хочу такой онигири." });
    const commentId = data.comment.id;
    let r = await other.call("PUT", `/api/comments/${commentId}/reactions`, { kind: "fire" });
    assert.deepEqual(r.data.reactions, { fire: 1 });
    r = await other.call("PUT", `/api/comments/${commentId}/reactions`, { kind: "poop" });
    assert.equal(r.status, 400);
    assert.equal((await other.call("PATCH", `/api/comments/${commentId}`, { body: "взлом" })).status, 403);
    assert.equal((await other.call("DELETE", `/api/comments/${commentId}`)).status, 403);
    r = await author.call("PATCH", `/api/comments/${commentId}`, { body: "Хочу два онигири." });
    assert.equal(r.data.comment.body, "Хочу два онигири.");
    assert.ok(r.data.comment.editedAt);
  });

  test("защита от спама: ссылки, повтор, частота", async () => {
    const spammer = await app.user("Спамер");
    const id = await app.titleByName("Ракетка и шторм");
    const links = "https://a.example https://b.example https://c.example https://d.example";
    let r = await spammer.call("POST", "/api/comments", { targetType: "title", targetId: id, body: links });
    assert.equal(r.status, 400);
    await spammer.call("POST", "/api/comments", { targetType: "title", targetId: id, body: "Первый" });
    r = await spammer.call("POST", "/api/comments", { targetType: "title", targetId: id, body: "Первый" });
    assert.equal(r.status, 409);
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await spammer.call("POST", "/api/comments", { targetType: "title", targetId: id, body: `Сообщение ${i}` })).status);
    }
    assert.ok(statuses.includes(429), `ожидался 429: ${statuses}`);
  });

  test("модератор удаляет комментарий, ответы остаются, автор заглушён", async () => {
    const author = await app.user("Грубиян");
    const replier = await app.user("Вежливый");
    const reporter = await app.user("Жалобщик");
    const moderator = await app.user("Модератор", "moderator");
    const id = await app.titleByName("Дом на краю кладбища");
    const root = (await author.call("POST", "/api/comments", { targetType: "title", targetId: id, body: "Грубость" })).data.comment;
    await replier.call("POST", "/api/comments", { targetType: "title", targetId: id, body: "Не надо так.", parentId: root.id });

    let r = await reporter.call("POST", "/api/reports", { targetType: "comment", targetId: root.id, reason: "abuse" });
    assert.equal(r.status, 201);
    r = await reporter.call("POST", "/api/reports", { targetType: "comment", targetId: root.id, reason: "abuse" });
    assert.equal(r.data.duplicate, true);
    const queue = await moderator.call("GET", "/api/moderation/reports");
    assert.ok(queue.data.groups.some((group) => group.targetType === "comment" && group.targetId === root.id));

    r = await moderator.call("POST", "/api/moderation/actions", {
      targetType: "comment", targetId: root.id, action: "remove", reason: "Оскорбления", muteDays: 3
    });
    assert.equal(r.status, 200);
    const list = await app.client().call("GET", `/api/comments?type=title&id=${id}`);
    const shown = list.data.comments.find((comment) => comment.id === root.id);
    assert.equal(shown.deleted, true);
    assert.equal(shown.body, "");
    assert.equal(shown.thread.length, 1);
    r = await author.call("POST", "/api/comments", { targetType: "title", targetId: id, body: "Снова я" });
    assert.equal(r.status, 403);
    const log = await moderator.call("GET", "/api/moderation/log");
    assert.ok(log.data.entries.some((entry) => entry.action === "comment.remove"));
  });

  test("обсуждения, теории и подборки", async () => {
    const reader = await app.user("Теоретик");
    const id = await app.titleByName("Тетрадь последнего лета");
    let r = await reader.call("POST", "/api/threads", { kind: "theory", subject: "Тетрадь пишет сама Хина", body: "Почерк совпадает.", titleId: id, spoiler: true });
    assert.equal(r.status, 201);
    assert.ok(r.data.achievements.includes("theorist"));
    const threadId = r.data.thread.id;
    r = await app.client().call("GET", "/api/threads?kind=theory");
    assert.ok(r.data.threads.some((thread) => thread.id === threadId));
    r = await reader.call("POST", "/api/comments", { targetType: "thread", targetId: threadId, body: "Согласна!" });
    assert.equal(r.status, 201);
    assert.equal((await app.client().call("GET", `/api/threads/${threadId}`)).data.thread.comments, 1);

    r = await reader.call("POST", "/api/collections", { name: "Тихие вечера", description: "Уютное" });
    const collectionId = r.data.collection.id;
    for (const name of ["Кухня у старого храма", "Котик и я: дневник соседей"]) {
      assert.equal((await reader.call("PUT", `/api/collections/${collectionId}/items`, { titleId: await app.titleByName(name) })).status, 200);
    }
    const stranger = await app.user("Чужой");
    assert.equal((await stranger.call("PUT", `/api/collections/${collectionId}/items`, { titleId: id })).status, 403);
    r = await app.client().call("GET", `/api/collections/${collectionId}`);
    assert.equal(r.data.items.length, 2);
    // Приватная подборка не видна другим
    await reader.call("PATCH", `/api/collections/${collectionId}`, { name: "Тихие вечера", isPublic: false });
    assert.equal((await stranger.call("GET", `/api/collections/${collectionId}`)).status, 404);
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
    assert.equal((await app.client().call("GET", `/api/users/${username}/library`)).status, 403);
    r = await star.call("GET", `/api/users/${username}`);
    assert.equal(r.data.private, false, "владелец видит свой профиль");
  });

  test("имя профиля проверяется и не занимается дважды", async () => {
    const a = await app.user("Первый");
    const b = await app.user("Второй");
    assert.equal((await a.call("PATCH", "/api/me/profile", { username: "night_reader" })).status, 200);
    assert.equal((await b.call("PATCH", "/api/me/profile", { username: "NIGHT_READER" })).status, 409);
    assert.equal((await b.call("PATCH", "/api/me/profile", { username: "ночь" })).status, 400);
    assert.equal((await b.call("PATCH", "/api/me/profile", { username: "admin" })).status, 409);
  });

  test("удаление аккаунта оставляет ответы других людей", async () => {
    const leaver = await app.user("Уходящий");
    const stayer = await app.user("Остающийся");
    const id = await app.titleByName("Песнь ледяного перевала");
    const root = (await leaver.call("POST", "/api/comments", { targetType: "title", targetId: id, body: "Пока!" })).data.comment;
    await stayer.call("POST", "/api/comments", { targetType: "title", targetId: id, body: "Удачи", parentId: root.id });
    assert.equal((await leaver.call("DELETE", "/api/me", { password: PASSWORD })).status, 200);
    const list = await app.client().call("GET", `/api/comments?type=title&id=${id}`);
    const shown = list.data.comments.find((comment) => comment.id === root.id);
    assert.equal(shown.deleted, true);
    assert.equal(shown.author, null);
    assert.equal(shown.thread[0].body, "Удачи");
  });
});

describe("Arena", () => {
  test("голос учитывается один раз, его можно перенести", async () => {
    const poll = (await app.client().call("GET", "/api/polls?kind=genre")).data.polls[0];
    const [first, second] = poll.options;
    const a = await app.user("Голосующий");
    const b = await app.user("Голосующая");
    let r = await a.call("PUT", `/api/polls/${poll.id}/vote`, { optionId: first.id });
    assert.equal(r.data.poll.total, 1);
    assert.equal(r.data.poll.myVote, first.id);
    r = await a.call("PUT", `/api/polls/${poll.id}/vote`, { optionId: second.id });
    assert.equal(r.data.poll.total, 1);
    assert.equal(r.data.poll.options.find((o) => o.id === second.id).votes, 1);
    r = await b.call("PUT", `/api/polls/${poll.id}/vote`, { optionId: second.id });
    assert.equal(r.data.poll.total, 2);
    assert.equal(r.data.poll.options.find((o) => o.id === second.id).percent, 100);
    // Вариант чужого голосования не принимается
    const other = (await app.client().call("GET", "/api/polls?kind=versus")).data.polls[0];
    r = await a.call("PUT", `/api/polls/${poll.id}/vote`, { optionId: other.options[0].id });
    assert.equal(r.status, 400);
    const boards = (await app.client().call("GET", "/api/arena/leaderboards")).data;
    assert.equal(boards.genres[0].name, second.label);
  });

  test("голосования создаёт модератор, закрытое не принимает голоса", async () => {
    const reader = await app.user("Читатель");
    const moderator = await app.user("Модератор", "moderator");
    const titles = (await app.client().call("GET", "/api/titles?limit=3")).data.titles;
    const body = { kind: "title", question: "Лучший финал года", options: titles.map((t) => ({ titleId: t.id })) };
    assert.equal((await reader.call("POST", "/api/polls", body)).status, 403);
    let r = await moderator.call("POST", "/api/polls", body);
    assert.equal(r.status, 201);
    const pollId = r.data.poll.id;
    assert.deepEqual(r.data.poll.options.map((o) => o.label), titles.map((t) => t.title));
    await moderator.call("PATCH", `/api/polls/${pollId}`, { status: "closed" });
    r = await reader.call("PUT", `/api/polls/${pollId}/vote`, { optionId: r.data.poll.options[0].id });
    assert.equal(r.status, 409);
  });

  test("турнир: сетка по посеву, голоса, переход раундов и победитель", async () => {
    const creator = await app.user("Организатор");
    const voters = [await app.user("В1"), await app.user("В2"), await app.user("В3")];
    const ids = (await app.client().call("GET", "/api/titles?limit=4&sort=title")).data.titles.map((t) => t.id);
    let r = await creator.call("POST", "/api/tournaments", { kind: "title", name: "Кубок осени", entries: ids.slice(0, 3) });
    assert.equal(r.status, 400, "участников должно быть 4, 8 или 16");
    r = await creator.call("POST", "/api/tournaments", { kind: "title", name: "Кубок осени", entries: ids });
    assert.equal(r.status, 201);
    let tournament = r.data.tournament;
    assert.equal(tournament.matches.length, 2);
    const [m1, m2] = tournament.matches;
    // Посев: 1-й против 4-го, 2-й против 3-го
    const seed = (entryId) => tournament.entries.find((e) => e.id === entryId).seed;
    assert.deepEqual([seed(m1.entryA), seed(m1.entryB)], [1, 4]);

    // В первом матче побеждает 4-й посев голосами, во втором ничья — проходит лучший посев
    for (const voter of voters) await voter.call("PUT", `/api/tournaments/${tournament.id}/matches/${m1.id}/vote`, { entryId: m1.entryB });
    await voters[0].call("PUT", `/api/tournaments/${tournament.id}/matches/${m2.id}/vote`, { entryId: m2.entryA });
    await voters[1].call("PUT", `/api/tournaments/${tournament.id}/matches/${m2.id}/vote`, { entryId: m2.entryB });

    assert.equal((await voters[0].call("POST", `/api/tournaments/${tournament.id}`, { action: "advance" })).status, 403);
    r = await creator.call("POST", `/api/tournaments/${tournament.id}`, { action: "advance" });
    tournament = r.data.tournament;
    assert.equal(tournament.round, 2);
    const final = tournament.matches.find((m) => m.round === 2);
    assert.deepEqual([final.entryA, final.entryB], [m1.entryB, m2.entryA]);
    // Голос в закрытом раунде не принимается
    r = await voters[2].call("PUT", `/api/tournaments/${tournament.id}/matches/${m1.id}/vote`, { entryId: m1.entryA });
    assert.equal(r.status, 409);

    await voters[2].call("PUT", `/api/tournaments/${tournament.id}/matches/${final.id}/vote`, { entryId: final.entryB });
    r = await creator.call("POST", `/api/tournaments/${tournament.id}`, { action: "advance" });
    assert.equal(r.data.tournament.status, "finished");
    assert.equal(r.data.tournament.winnerEntryId, final.entryB);
  });
});

describe("роли и админка", () => {
  test("права проверяются на сервере для каждой роли", async () => {
    const reader = await app.user("Читатель");
    const moderator = await app.user("Модератор", "moderator");
    const admin = await app.user("Админ", "admin");
    const guest = app.client();
    for (const url of ["/api/admin/titles", "/api/admin/genres", "/api/admin/platform-stats", "/api/admin/users"]) {
      assert.equal((await guest.call("GET", url)).status, 401, url);
      assert.equal((await reader.call("GET", url)).status, 403, url);
      assert.equal((await moderator.call("GET", url)).status, 403, url);
      assert.equal((await admin.call("GET", url)).status, 200, url);
    }
    assert.equal((await reader.call("GET", "/api/moderation/reports")).status, 403);
    assert.equal((await moderator.call("GET", "/api/moderation/reports")).status, 200);
  });

  test("роль выдаёт администратор с паролем, свою роль сменить нельзя", async () => {
    const admin = await app.user("Главный", "admin");
    const reader = await app.user("Будущий модератор");
    let r = await admin.call("PUT", `/api/admin/users/${reader.id}/role`, { role: "moderator", password: "wrong-password-1" });
    assert.equal(r.status, 403);
    r = await admin.call("PUT", `/api/admin/users/${reader.id}/role`, { role: "moderator", password: PASSWORD });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, "moderator");
    assert.equal((await reader.call("GET", "/api/me")).data.user.isModerator, true);
    r = await admin.call("PUT", `/api/admin/users/${admin.id}/role`, { role: "user", password: PASSWORD });
    assert.equal(r.status, 409);
  });

  test("тайтл из админки: жанры, автор, теги и источники попадают в справочники", async () => {
    const admin = await app.user("Редактор", "admin");
    const body = {
      title: "Тестовый тайтл", originalTitle: "Test", type: "manhwa", status: "ongoing", year: 2026, rating: 7.5,
      genres: ["Экшен", "Новый жанр"], author: "Автор Один, Автор Два", translator: "Endemion", symbol: "✦",
      colors: ["#111111", "#222222", "#333333"], description: "Описание.", releaseDay: 2,
      tags: [{ code: "mood-dark", weight: 3 }], sources: [{ name: "Издатель", url: "https://publisher.example/title" }]
    };
    let r = await admin.call("POST", "/api/admin/titles", { ...body, sources: [{ name: "Плохой", url: "http://x.example" }] });
    assert.equal(r.status, 400, "только https-ссылки");
    r = await admin.call("POST", "/api/admin/titles", body);
    assert.equal(r.status, 201);
    const id = r.data.title.id;
    const details = (await app.client().call("GET", `/api/titles/${id}/details`)).data;
    assert.deepEqual(details.tags.map((tag) => tag.code), ["mood-dark"]);
    assert.equal(details.sources[0].url, "https://publisher.example/title");
    const genres = (await admin.call("GET", "/api/admin/genres")).data.items;
    assert.ok(genres.some((genre) => genre.name === "Новый жанр" && genre.titles === 1));
    const authors = (await admin.call("GET", "/api/admin/authors")).data.items;
    assert.ok(authors.some((author) => author.name === "Автор Два"));
    r = await app.client().call("GET", `/api/titles?q=${encodeURIComponent("Автор Два")}&field=author`);
    assert.deepEqual(r.data.titles.map((t) => t.id), [id]);
    // Используемый жанр не удаляется
    const genre = genres.find((g) => g.name === "Новый жанр");
    assert.equal((await admin.call("DELETE", `/api/admin/genres/${genre.id}`)).status, 409);
    // Переименование жанра обновляет карточку тайтла
    await admin.call("PUT", `/api/admin/genres/${genre.id}`, { name: "Свежий жанр", description: "" });
    assert.ok((await app.client().call("GET", `/api/titles/${id}`)).data.title.genres.includes("Свежий жанр"));
    assert.equal((await admin.call("DELETE", `/api/admin/titles/${id}`)).status, 200);
  });

  test("тестовый администратор из seed", async () => {
    const id = await app.seedAdmin("seed-admin@example.com", "seed-admin-pass-1");
    const row = await app.db.prepare("SELECT role FROM users WHERE id = ?").bind(id).first();
    assert.equal(row.role, "admin");
    const guest = app.client();
    const r = await guest.call("POST", "/api/auth/login", { email: "seed-admin@example.com", password: "seed-admin-pass-1" });
    assert.equal(r.status, 200);
    assert.equal((await guest.call("GET", "/api/admin/titles")).status, 200);
  });
});
