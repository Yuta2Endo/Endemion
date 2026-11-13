// Комментарии ENDEMION COMMUNITY: список с ответами, форма, реакции, правка, удаление и жалобы.
// Используется в темах форума: mountComments(контейнер, { targetType: "thread", targetId })

import {
  announceAchievements, api, askLogin, avatar, button, el, errorBox, getMe, goal, lineSkeletons, link, reportContent,
  spoilerText, stateBox, timeAgo, toast, userLink
} from "./app.js";

const REACTIONS = { like: "👍", fire: "🔥", heart: "❤️", laugh: "😂", wow: "😮", sad: "😢" };
const MAX = 3000;

/** Форма комментария или ответа. onSent(comment) — после успешной отправки */
function commentForm({ targetType, targetId, parentId = null, placeholder, onSent, onCancel = null, autofocus = false }) {
  const form = el("form", "comment-form");
  form.noValidate = true;
  const area = el("textarea", "textarea");
  area.maxLength = MAX;
  area.rows = parentId ? 2 : 3;
  area.placeholder = placeholder;
  area.setAttribute("aria-label", parentId ? "Текст ответа" : "Текст комментария");
  const actions = el("div", "comment-form-actions");
  const spoiler = el("label", "check");
  const spoilerBox = el("input");
  spoilerBox.type = "checkbox";
  spoiler.append(spoilerBox, document.createTextNode("Спойлер"));
  const right = el("div", "section-actions");
  if (onCancel) right.append(button("Отмена", "ghost-btn small-btn", onCancel));
  const submit = el("button", "primary-btn small-btn", parentId ? "Ответить" : "Отправить");
  submit.type = "submit";
  right.append(submit);
  actions.append(spoiler, right);
  const message = el("p", "form-error");
  message.setAttribute("role", "alert");
  form.append(area, actions, message);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = area.value.trim();
    if (!body) {
      message.textContent = "Напишите текст комментария.";
      return;
    }
    submit.disabled = true;
    const result = await api("/api/comments", {
      method: "POST",
      body: { targetType, targetId, parentId, body, spoiler: spoilerBox.checked }
    });
    submit.disabled = false;
    if (!result.ok) {
      message.textContent = result.data?.error || "Не удалось отправить комментарий.";
      return;
    }
    area.value = "";
    spoilerBox.checked = false;
    message.textContent = "";
    goal("comment");
    announceAchievements(result.data.achievements);
    onSent(result.data.comment);
  });
  if (autofocus) queueMicrotask(() => area.focus());
  return form;
}

/** Реакции под комментарием: счётчики и выбор своей */
function reactionBar(comment, user) {
  const bar = el("div", "reactions");
  const render = () => {
    bar.replaceChildren();
    for (const [kind, count] of Object.entries(comment.reactions)) {
      if (!count) continue;
      const mine = comment.myReactions.includes(kind);
      bar.append(button(`${REACTIONS[kind]} ${count}`, "reaction", () => toggle(kind), {
        pressed: mine, label: `${REACTIONS[kind]} ${count}${mine ? ", ваша реакция" : ""}`
      }));
    }
  };
  async function toggle(kind) {
    if (!user) return askLogin("Чтобы ставить реакции, войдите в профиль.");
    const mine = comment.myReactions.includes(kind);
    const result = await api(`/api/comments/${comment.id}/reactions`, { method: mine ? "DELETE" : "PUT", body: { kind } });
    if (!result.ok) return toast(result.data?.error || "Не удалось поставить реакцию.");
    comment.reactions = result.data.reactions;
    comment.myReactions = result.data.myReactions;
    render();
  }
  render();
  return { bar, toggle };
}

/** Один комментарий с действиями. isReply — ответ внутри ветки */
function commentNode(comment, ctx, isReply = false) {
  const node = el("article", "comment");
  node.id = `comment-${comment.id}`;
  node.append(comment.author ? avatar(comment.author, isReply ? "avatar-sm" : "") : avatar(null, isReply ? "avatar-sm" : ""));
  const main = el("div");
  const head = el("div", "comment-head");
  if (comment.author) {
    head.append(comment.author.username
      ? link(`/users/${encodeURIComponent(comment.author.username)}`, null, comment.author.name)
      : el("strong", null, comment.author.name));
    if (comment.author.role !== "user") head.append(el("span", "role-badge", comment.author.role === "admin" ? "админ" : "модератор"));
  } else {
    head.append(el("strong", "muted", comment.deleted ? "Комментарий удалён" : "Удалённый пользователь"));
  }
  if (comment.replyTo) head.append(el("small", null, `→ ${comment.replyTo}`));
  const time = el("time", null, timeAgo(comment.createdAt));
  time.dateTime = `${comment.createdAt.replace(" ", "T")}Z`;
  head.append(time);
  if (comment.editedAt) head.append(el("small", null, "изменён"));

  const text = el("p", `comment-text${comment.deleted ? " is-deleted" : ""}`, comment.deleted ? "Комментарий удалён." : comment.body);
  main.append(head, comment.deleted ? text : spoilerText(text, comment.spoiler));

  if (!comment.deleted) {
    const actions = el("div", "comment-actions");
    const { bar, toggle } = reactionBar(comment, ctx.user);
    const picker = el("span", "reaction-picker");
    const add = button("☺ +", null, () => {
      if (!ctx.user) return askLogin("Чтобы ставить реакции, войдите в профиль.");
      const open = picker.querySelector(".reaction-menu");
      if (open) return open.remove();
      const menu = el("span", "reaction-menu");
      for (const [kind, emoji] of Object.entries(REACTIONS)) {
        menu.append(button(emoji, null, () => {
          menu.remove();
          toggle(kind);
        }, { label: `Реакция ${emoji}` }));
      }
      picker.append(menu);
      menu.querySelector("button")?.focus();
    }, { label: "Поставить реакцию" });
    picker.append(add);
    actions.append(bar, picker);

    if (!ctx.locked && ctx.user && comment.body) actions.append(button("Цитировать", null, () => ctx.quote(comment)));
    if (!ctx.locked) actions.append(button("Ответить", null, () => {
      if (!ctx.user) return askLogin("Чтобы отвечать, войдите в профиль.");
      if (node.querySelector(":scope > div > .comment-form")) return;
      const form = commentForm({
        targetType: ctx.targetType,
        targetId: ctx.targetId,
        parentId: comment.id,
        placeholder: comment.author ? `Ответ для ${comment.author.name}…` : "Ваш ответ…",
        autofocus: true,
        onCancel: () => form.remove(),
        onSent: (reply) => {
          form.remove();
          ctx.addReply(comment.rootId || comment.id, reply);
        }
      });
      main.append(form);
    }));
    if (comment.canEdit) actions.append(button("Изменить", null, () => editComment(comment, text, main)));
    if (comment.canDelete) {
      actions.append(button("Удалить", null, async () => {
        if (!confirm(comment.canEdit ? "Удалить комментарий?" : "Удалить чужой комментарий как модератор?")) return;
        const result = await api(`/api/comments/${comment.id}`, { method: "DELETE" });
        if (!result.ok) return toast(result.data?.error || "Не удалось удалить.");
        comment.deleted = true;
        node.replaceWith(commentNode(comment, ctx, isReply));
      }));
    }
    if (ctx.user && !comment.canEdit && comment.author) actions.append(button("Пожаловаться", null, () => reportContent("comment", comment.id)));
    main.append(actions);
  }

  if (!isReply) {
    const replies = el("div", "comment-replies");
    replies.dataset.root = String(comment.id);
    for (const reply of comment.thread || []) replies.append(commentNode(reply, ctx, true));
    if (!replies.children.length) replies.hidden = true;
    main.append(replies);
  }
  node.append(main);
  return node;
}

function editComment(comment, text, main) {
  const form = el("form", "comment-form");
  const area = el("textarea", "textarea");
  area.value = comment.body;
  area.maxLength = MAX;
  area.rows = 3;
  area.setAttribute("aria-label", "Текст комментария");
  const actions = el("div", "section-actions");
  const save = el("button", "primary-btn small-btn", "Сохранить");
  save.type = "submit";
  actions.append(button("Отмена", "ghost-btn small-btn", () => {
    form.remove();
    text.hidden = false;
  }), save);
  form.append(area, actions);
  text.hidden = true;
  text.after(form);
  area.focus();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api(`/api/comments/${comment.id}`, { method: "PATCH", body: { body: area.value, spoiler: comment.spoiler } });
    if (!result.ok) return toast(result.data?.error || "Не удалось сохранить.");
    comment.body = result.data.comment.body;
    text.textContent = comment.body;
    text.hidden = false;
    form.remove();
    if (!main.querySelector(".comment-head small:last-child")?.textContent?.includes("изменён")) {
      main.querySelector(".comment-head")?.append(el("small", null, "изменён"));
    }
  });
}

/**
 * Комментарии к цели в контейнере. Возвращает { reload }.
 * Если в адресе #comment-N, после загрузки страница прокручивается к этому комментарию
 */
export async function mountComments(container, { targetType, targetId, placeholder = "Поделитесь мнением…", locked = false }) {
  const { user } = await getMe();
  const list = el("div", "comment-list");
  const more = button("Показать ещё", "ghost-btn", () => load(false));
  more.hidden = true;
  const total = el("p", "muted small");
  let offset = 0;
  let sort = "new";

  const ctx = {
    user,
    targetType,
    targetId,
    locked,
    /** Вставить цитату в основную форму: «> Имя: текст» и пустая строка для ответа */
    quote(comment) {
      const area = container.querySelector(".comments > .comment-form textarea");
      if (!area) return;
      const quoted = comment.body.split("\n").map((line) => `> ${line}`).join("\n");
      const head = comment.author ? `> ${comment.author.name}:\n` : "";
      area.value = `${area.value ? `${area.value.trimEnd()}\n\n` : ""}${head}${quoted}\n\n`.slice(0, MAX);
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    },
    addReply(rootId, reply) {
      const replies = list.querySelector(`.comment-replies[data-root="${rootId}"]`);
      if (!replies) return;
      replies.hidden = false;
      replies.append(commentNode(reply, ctx, true));
    }
  };

  const top = el("div", "comment-form-actions");
  const sortBar = el("div", "chips");
  for (const [key, label] of [["new", "Новые"], ["top", "Популярные"]]) {
    sortBar.append(button(label, "chip", () => {
      sort = key;
      sortBar.querySelectorAll("button").forEach((node) => node.setAttribute("aria-pressed", String(node.textContent === label)));
      load(true);
    }, { pressed: key === sort }));
  }
  top.append(total, sortBar);

  const formBox = locked
    ? stateBox({ icon: "🔒", text: "Тема закрыта модератором, новые ответы не принимаются." })
    : user
    ? commentForm({
      targetType, targetId, placeholder,
      onSent(comment) {
        list.querySelector(".state")?.remove();
        list.prepend(commentNode({ ...comment, thread: [] }, ctx));
      }
    })
    : stateBox({ icon: "💬", text: "Войдите, чтобы писать комментарии и отвечать.", action: { href: `/auth?next=${encodeURIComponent(location.pathname)}`, text: "Войти" } });

  container.replaceChildren(el("div", "comments"));
  container.firstChild.append(formBox, top, list, more);

  async function load(reset) {
    if (reset) {
      offset = 0;
      list.replaceChildren(...lineSkeletons(3, 64));
    }
    const params = new URLSearchParams({ type: targetType, id: String(targetId), offset: String(offset), sort });
    const result = await api(`/api/comments?${params}`);
    if (!result.ok) {
      list.replaceChildren(errorBox(result.data?.error || "Комментарии не загрузились.", () => load(true)));
      return;
    }
    if (reset) list.replaceChildren();
    const { comments, hasMore } = result.data;
    total.textContent = result.data.total ? `Комментариев: ${result.data.total}` : "";
    if (reset && !comments.length && user) {
      list.append(stateBox({ icon: "💬", title: "Пока тихо", text: "Начните обсуждение первым." }));
    }
    for (const comment of comments) list.append(commentNode(comment, ctx));
    offset += comments.length;
    more.hidden = !hasMore;
  }

  await load(true);
  const anchor = location.hash.match(/^#comment-(\d+)$/);
  if (anchor) document.getElementById(`comment-${anchor[1]}`)?.scrollIntoView({ block: "center" });
  return { reload: () => load(true) };
}

export { userLink };
