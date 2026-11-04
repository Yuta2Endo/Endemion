// ENDEMION ARENA: голосования (персонажи, тайтлы, жанры, «кто кого»), турниры на выбывание, таблицы лидеров.
// Результаты приходят с сервера и считаются только по голосам читателей. Вкладка — в адресе: /arena#tournaments

import {
  announceAchievements, api, avatar, button, el, errorBox, field, formValue, getMe, initHeader, input, lineSkeletons,
  link, loginUrl, openDialog, reportContent, stateBox, textarea, timeAgo, titlePicker, toast
} from "./app.js";

const body = document.querySelector("#arenaBody");
const actions = document.querySelector("#arenaActions");
const tabs = [...document.querySelectorAll("[data-tab]")];
const TABS = tabs.map((tab) => tab.dataset.tab);
const KIND_LABELS = { character: "Персонажи", title: "Тайтлы", genre: "Жанры", versus: "Кто кого" };

let user = null;
let current = "polls";

function needLogin() {
  toast("Чтобы голосовать, войдите в профиль.");
  setTimeout(() => (location.href = loginUrl()), 900);
}

// ==================== ГОЛОСОВАНИЯ ====================

function optionButton(poll, option, onVote) {
  const voted = poll.myVote === option.id;
  const node = button("", `poll-option${option.leading ? " is-leading" : ""}`, () => onVote(option), {
    pressed: voted,
    label: `${option.label}: ${option.votes} голосов, ${option.percent}%${voted ? ", ваш голос" : ""}`
  });
  node.style.setProperty("--share", `${option.percent}%`);
  node.disabled = poll.status !== "open";
  const text = el("span");
  text.append(el("strong", null, option.label));
  if (option.subtitle) text.append(el("small", null, option.subtitle));
  node.append(el("b", null, option.symbol || "✦"), text, el("span", "poll-share", `${option.percent}%`));
  return node;
}

function pollCard(poll) {
  const card = el("article", "poll");
  card.id = `poll-${poll.id}`;
  const head = el("div", "thread-meta");
  head.append(el("span", "kind-badge", KIND_LABELS[poll.kind]), el("span", null, poll.status === "open" ? "Идёт голосование" : "Завершено"));
  if (poll.endsAt && poll.status === "open") head.append(el("span", null, `до ${new Date(`${poll.endsAt.replace(" ", "T")}Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`));
  card.append(head, el("h3", null, poll.question));
  if (poll.description) card.append(el("p", "muted small", poll.description));

  const options = el("div", `poll-options${poll.kind === "versus" ? " versus" : ""}`);
  const vote = async (option) => {
    if (!user) return needLogin();
    const result = await api(`/api/polls/${poll.id}/vote`, { method: "PUT", body: { optionId: option.id } });
    if (!result.ok) return toast(result.data?.error || "Голос не принят.");
    announceAchievements(result.data.achievements);
    card.replaceWith(pollCard(result.data.poll));
  };
  if (poll.kind === "versus" && poll.options.length === 2) {
    options.append(optionButton(poll, poll.options[0], vote), el("span", "versus-mark", "VS"), optionButton(poll, poll.options[1], vote));
  } else {
    options.append(...poll.options.map((option) => optionButton(poll, option, vote)));
  }
  card.append(options);

  const foot = el("div", "poll-foot");
  foot.append(el("span", null, poll.total ? `Голосов: ${poll.total}` : "Голосов пока нет — будьте первым"));
  const right = el("span", "section-actions");
  if (poll.myVote && poll.status === "open") {
    right.append(button("Отозвать голос", "link-btn small", async () => {
      const result = await api(`/api/polls/${poll.id}/vote`, { method: "DELETE" });
      if (!result.ok) return toast(result.data?.error || "Не удалось.");
      card.replaceWith(pollCard(result.data.poll));
    }));
  }
  if (user?.isModerator) {
    right.append(button(poll.status === "open" ? "Закрыть" : "Открыть", "link-btn small", async () => {
      const result = await api(`/api/polls/${poll.id}`, { method: "PATCH", body: { status: poll.status === "open" ? "closed" : "open" } });
      if (!result.ok) return toast(result.data?.error || "Не удалось.");
      card.replaceWith(pollCard(result.data.poll));
    }), button("Удалить", "link-btn small", async () => {
      if (!confirm("Удалить голосование вместе с голосами?")) return;
      const result = await api(`/api/polls/${poll.id}`, { method: "DELETE" });
      if (!result.ok) return toast(result.data?.error || "Не удалось.");
      card.remove();
    }));
  }
  foot.append(right);
  card.append(foot);
  return card;
}

async function showPolls() {
  const chips = el("div", "chips");
  const grid = el("div", "poll-grid section");
  body.replaceChildren(chips, grid);
  let status = "open";
  const load = async () => {
    chips.querySelectorAll("button").forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.status === status)));
    grid.replaceChildren(...lineSkeletons(2, 260));
    const result = await api(`/api/polls${status ? `?status=${status}` : ""}`);
    if (!result.ok) return grid.replaceChildren(errorBox(result.data?.error || "Голосования не загрузились.", load));
    if (!result.data.polls.length) {
      return grid.replaceChildren(stateBox({ icon: "🗳", title: status === "open" ? "Сейчас нет открытых голосований" : "Голосований нет", text: "Загляните в турниры — их создают сами читатели." }));
    }
    grid.replaceChildren(...result.data.polls.map(pollCard));
    const anchor = location.hash.match(/poll-(\d+)/);
    if (anchor) document.getElementById(`poll-${anchor[1]}`)?.scrollIntoView({ block: "center" });
  };
  for (const [value, label] of [["open", "Открытые"], ["closed", "Завершённые"], ["", "Все"]]) {
    const chip = button(label, "chip", () => {
      status = value;
      load();
    });
    chip.dataset.status = value;
    chips.append(chip);
  }
  await load();
}

/** Подбор вариантов для голосования: тайтлы, персонажи или жанры */
async function newPoll() {
  const options = [];
  let kind = "character";
  const genres = (await api("/api/taxonomy")).data?.genres || [];
  await openDialog({
    title: "Новое голосование",
    submitText: "Создать",
    build(form) {
      const kindSelect = el("select", "select");
      kindSelect.name = "kind";
      for (const [value, label] of Object.entries(KIND_LABELS)) kindSelect.append(new Option(label, value));
      const picked = el("div", "picked");
      const pickerBox = el("div");
      const renderPicked = () => {
        picked.replaceChildren(...options.map((option, i) => {
          const tag = el("span", "tag is-strong", option.label);
          tag.append(button("✕", null, () => {
            options.splice(i, 1);
            renderPicked();
          }, { label: `Убрать ${option.label}` }));
          return tag;
        }));
      };
      const add = (option) => {
        if (options.some((item) => JSON.stringify(item) === JSON.stringify(option))) return;
        options.push(option);
        renderPicked();
      };
      const renderPicker = () => {
        options.length = 0;
        renderPicked();
        pickerBox.replaceChildren();
        if (kind === "genre") {
          const chips = el("div", "chips");
          chips.append(...genres.map((genre) => button(genre.name, "chip", () => add({ genreId: genre.id, label: genre.name }))));
          pickerBox.append(chips);
        } else if (kind === "title") {
          pickerBox.append(titlePicker({ placeholder: "Добавить тайтл…", onPick: (title) => add({ titleId: title.id, label: title.title }) }).root);
        } else {
          pickerBox.append(characterPicker((character) => add({ characterId: character.id, label: character.name })));
        }
      };
      kindSelect.addEventListener("change", () => {
        kind = kindSelect.value;
        renderPicker();
      });
      form.append(
        field("Вид", kindSelect),
        field("Вопрос", input("question", { maxLength: 200, placeholder: "Например, «Лучший антагонист сезона»" })),
        field("Описание", textarea("description", { maxLength: 1000, rows: 2 })),
        field("Срок, дней (пусто — пока не закроете)", input("days", { type: "number", maxLength: 0 })),
        field("Варианты", pickerBox, "В «кто кого» — ровно два персонажа или два тайтла"),
        picked
      );
      renderPicker();
    },
    async onSubmit(form) {
      const days = formValue(form, "days");
      const result = await api("/api/polls", {
        method: "POST",
        body: {
          kind, question: formValue(form, "question"), description: formValue(form, "description"),
          days: days ? Number(days) : null,
          options: options.map(({ label: _label, ...rest }) => rest)
        }
      });
      if (!result.ok) return result.data?.error || "Не удалось создать голосование.";
      open("polls");
      return null;
    }
  });
}

/** Поиск персонажа по имени или тайтлу */
function characterPicker(onPick) {
  const root = el("div", "picker");
  const query = input("character", { type: "search", placeholder: "Имя персонажа или тайтл…", maxLength: 60 });
  query.setAttribute("aria-label", "Найти персонажа");
  const list = el("div", "picker-list");
  list.hidden = true;
  root.append(query, list);
  let timer = null;
  query.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (query.value.trim().length < 2) return (list.hidden = true);
      const result = await api(`/api/characters?${new URLSearchParams({ q: query.value.trim() })}`);
      const found = result.ok ? result.data.characters : [];
      list.replaceChildren(...(found.length ? found.map((character) => {
        const option = button("", null, () => {
          list.hidden = true;
          query.value = "";
          onPick(character);
        });
        const text = el("span");
        text.append(el("strong", null, character.name), el("small", null, character.title));
        option.append(el("span", "picker-thumb", character.symbol), text);
        return option;
      }) : [el("p", "muted small", "Не нашлось.")]));
      list.hidden = false;
    }, 200);
  });
  return root;
}

// ==================== ТУРНИРЫ ====================

const ROUND_NAMES = (rounds, round) => {
  const left = rounds - round;
  if (left === 0) return "Финал";
  if (left === 1) return "Полуфинал";
  if (left === 2) return "Четвертьфинал";
  return `Раунд ${round}`;
};

async function showTournaments() {
  const list = el("div", "stack");
  body.replaceChildren(list);
  list.append(...lineSkeletons(3, 110));
  const result = await api("/api/tournaments");
  if (!result.ok) return list.replaceChildren(errorBox(result.data?.error || "Турниры не загрузились.", showTournaments));
  if (!result.data.tournaments.length) {
    return list.replaceChildren(stateBox({
      icon: "🏆", title: "Турниров пока нет", text: "Соберите 4, 8 или 16 тайтлов или персонажей — читатели решат, кто лучший.",
      action: { text: "Создать турнир", onClick: newTournament }
    }));
  }
  list.replaceChildren(...result.data.tournaments.map((tournament) => {
    const item = el("article", "thread-item");
    const main = el("div");
    const meta = el("div", "thread-meta");
    meta.append(el("span", "kind-badge", tournament.kind === "title" ? "Тайтлы" : "Персонажи"),
      el("span", null, tournament.status === "finished" ? `Победитель: ${tournament.winner}` : `Раунд ${tournament.round}`),
      el("span", null, `${tournament.size} участников · голосов: ${tournament.votes}`));
    if (tournament.hidden) meta.append(el("span", "tag", "Скрыт модератором"));
    const heading = el("h3");
    const a = link(`#tournament-${tournament.id}`, null, tournament.name);
    a.addEventListener("click", (event) => {
      event.preventDefault();
      showTournament(tournament.id);
    });
    heading.append(a);
    main.append(meta, heading);
    if (tournament.description) main.append(el("p", null, tournament.description));
    const count = el("div", "thread-count");
    count.append(el("strong", null, tournament.status === "finished" ? "🏆" : "⚔"), el("small", null, timeAgo(tournament.createdAt)));
    item.append(main, count);
    return item;
  }));
  const anchor = location.hash.match(/tournament-(\d+)/);
  if (anchor) showTournament(Number(anchor[1]));
}

async function showTournament(id) {
  history.replaceState(null, "", `#tournament-${id}`);
  body.replaceChildren(...lineSkeletons(1, 320));
  const result = await api(`/api/tournaments/${id}`);
  if (!result.ok) return body.replaceChildren(errorBox(result.data?.error || "Турнир не загрузился.", () => showTournament(id)));
  renderTournament(result.data.tournament);
}

function renderTournament(tournament) {
  const entries = new Map(tournament.entries.map((entry) => [entry.id, entry]));
  const back = button("← Все турниры", "ghost-btn small-btn", () => {
    history.replaceState(null, "", "#tournaments");
    showTournaments();
  });
  const head = el("div", "page-head section");
  const text = el("div");
  text.append(el("div", "eyebrow", tournament.kind === "title" ? "Турнир тайтлов" : "Турнир персонажей"), el("h2", null, tournament.name));
  if (tournament.description) text.append(el("p", "section-text", tournament.description));
  if (tournament.author) {
    const byline = el("p", "muted small");
    byline.append("Автор: ", tournament.author.username ? link(`/users/${encodeURIComponent(tournament.author.username)}`, null, tournament.author.name) : tournament.author.name);
    text.append(byline);
  }
  const buttons = el("div", "section-actions");
  const canManage = user && (user.id === tournament.createdBy || user.isModerator);
  if (canManage && tournament.status === "voting") {
    buttons.append(button(tournament.round === tournament.rounds ? "Завершить финал" : "Закрыть раунд", "primary-btn", async () => {
      if (!confirm("Закрыть раунд? Победители матчей определятся по голосам, при ничьей проходит участник с лучшим посевом.")) return;
      const result = await api(`/api/tournaments/${tournament.id}`, { method: "POST", body: { action: "advance" } });
      if (!result.ok) return toast(result.data?.error || "Не удалось закрыть раунд.");
      renderTournament(result.data.tournament);
    }));
  }
  if (canManage) {
    buttons.append(button("Удалить", "danger-btn", async () => {
      if (!confirm("Удалить турнир?")) return;
      const result = await api(`/api/tournaments/${tournament.id}`, { method: "DELETE" });
      if (!result.ok) return toast(result.data?.error || "Не удалось.");
      showTournaments();
    }));
  } else if (user) {
    buttons.append(button("Пожаловаться", "ghost-btn", () => reportContent("tournament", tournament.id)));
  }
  head.append(text, buttons);

  const bracket = el("div", "bracket section");
  for (let round = 1; round <= tournament.rounds; round++) {
    const column = el("div", "bracket-round");
    column.append(el("h4", null, ROUND_NAMES(tournament.rounds, round)));
    const matches = tournament.matches.filter((match) => match.round === round);
    if (!matches.length) column.append(el("p", "muted small", "Ждёт победителей прошлого раунда"));
    for (const match of matches) {
      const box = el("div", `match${round === tournament.round && tournament.status === "voting" ? " is-current" : ""}`);
      const total = match.votesA + match.votesB;
      for (const [entryId, votes] of [[match.entryA, match.votesA], [match.entryB, match.votesB]]) {
        const entry = entries.get(entryId);
        const share = total ? Math.round((votes / total) * 100) : 0;
        const active = round === tournament.round && tournament.status === "voting";
        const node = button("", `poll-option${match.winnerId === entryId ? " is-winner" : ""}`, async () => {
          if (!user) return needLogin();
          const result = await api(`/api/tournaments/${tournament.id}/matches/${match.id}/vote`, { method: "PUT", body: { entryId } });
          if (!result.ok) return toast(result.data?.error || "Голос не принят.");
          announceAchievements(result.data.achievements);
          renderTournament(result.data.tournament);
        }, { pressed: match.myVote === entryId, label: `${entry.label}: ${votes} голосов` });
        node.disabled = !active;
        node.style.setProperty("--share", `${share}%`);
        const label = el("span");
        label.append(el("strong", null, entry.label), el("small", null, `посев ${entry.seed}`));
        node.append(el("b", null, entry.symbol), label, el("span", "poll-share", String(votes)));
        box.append(node);
      }
      column.append(box);
    }
    bracket.append(column);
  }
  const nodes = [back, head];
  if (tournament.status === "finished") {
    const winner = entries.get(tournament.winnerEntryId);
    const champion = el("div", "champion section");
    champion.append(el("b", null, "🏆"), el("strong", null, winner?.label || "—"), el("span", "muted small", "Победитель по голосам читателей"));
    if (winner?.titleId) champion.append(link(`/title/${winner.titleId}`, "ghost-btn small-btn", "Страница тайтла"));
    nodes.push(champion);
  }
  nodes.push(bracket);
  if (tournament.status === "voting") nodes.push(el("p", "muted small", "Голосовать можно в матчах текущего раунда. Голос можно перенести, пока раунд не закрыт."));
  body.replaceChildren(...nodes);
}

async function newTournament() {
  if (!user) return (location.href = loginUrl());
  const entries = [];
  let kind = "title";
  await openDialog({
    title: "Новый турнир",
    submitText: "Создать турнир",
    build(form) {
      const kindSelect = el("select", "select");
      kindSelect.name = "kind";
      kindSelect.append(new Option("Тайтлы", "title"), new Option("Персонажи", "character"));
      const list = el("ol", "stack");
      const pickerBox = el("div");
      const counter = el("p", "muted small");
      const renderList = () => {
        counter.textContent = `Участников: ${entries.length}. Нужно 4, 8 или 16. Порядок — посев: первый встретится с последним.`;
        list.replaceChildren(...entries.map((entry, i) => {
          const row = el("li", "tag is-strong", `${i + 1}. ${entry.label}`);
          row.append(button("✕", null, () => {
            entries.splice(i, 1);
            renderList();
          }, { label: `Убрать ${entry.label}` }));
          return row;
        }));
      };
      const add = (entry) => {
        if (entries.length >= 16) return toast("Не больше 16 участников.");
        if (entries.some((item) => item.id === entry.id)) return;
        entries.push(entry);
        renderList();
      };
      const renderPicker = () => {
        entries.length = 0;
        renderList();
        pickerBox.replaceChildren(kind === "title"
          ? titlePicker({ placeholder: "Добавить тайтл…", onPick: (title) => add({ id: title.id, label: title.title }) }).root
          : characterPicker((character) => add({ id: character.id, label: character.name })));
      };
      kindSelect.addEventListener("change", () => {
        kind = kindSelect.value;
        renderPicker();
      });
      form.append(
        field("Название", input("name", { maxLength: 100, placeholder: "Например, «Кубок сильнейших героев»" })),
        field("Описание", textarea("description", { maxLength: 1000, rows: 2 })),
        field("Кто участвует", kindSelect),
        pickerBox, counter, list
      );
      renderPicker();
    },
    async onSubmit(form) {
      const result = await api("/api/tournaments", {
        method: "POST",
        body: { kind, name: formValue(form, "name"), description: formValue(form, "description"), entries: entries.map((entry) => entry.id) }
      });
      if (!result.ok) return result.data?.error || "Не удалось создать турнир.";
      current = "tournaments";
      tabs.forEach((node) => node.setAttribute("aria-selected", String(node.dataset.tab === "tournaments")));
      renderActions();
      renderTournament(result.data.tournament);
      history.replaceState(null, "", `#tournament-${result.data.tournament.id}`);
      return null;
    }
  });
}

// ==================== ЛИДЕРЫ ====================

async function showLeaders() {
  body.replaceChildren(...lineSkeletons(2, 260));
  const result = await api("/api/arena/leaderboards");
  if (!result.ok) return body.replaceChildren(errorBox(result.data?.error || "Таблицы не загрузились.", showLeaders));
  const { characters, titles, genres, readers } = result.data;
  const board = (heading, note, rows, render) => {
    const panel = el("section", "panel");
    panel.append(el("h2", null, heading), el("p", "muted small", note));
    if (!rows.length) {
      panel.append(el("p", "muted small section", "Пока нет голосов. Таблица заполнится, когда читатели начнут голосовать."));
      return panel;
    }
    const list = el("ol", "leader-list section");
    list.append(...rows.map((row) => {
      const item = el("li");
      item.append(...render(row));
      return item;
    }));
    panel.append(list);
    return panel;
  };
  const grid = el("div", "leader-grid");
  grid.append(
    board("Персонажи", "Голоса в голосованиях и турнирах", characters, (row) => {
      const name = el("span");
      name.append(el("strong", null, `${row.symbol} ${row.name}`), el("small", null, ` · ${row.title}`));
      return [name, el("strong", null, String(row.votes))];
    }),
    board("Тайтлы", "Оценки читателей с поправкой на их число", titles, (row) => {
      const name = el("span");
      name.append(link(`/title/${row.id}`, null, row.title), el("small", null, ` · ${row.votes} оценок`));
      return [name, el("strong", "t-rating", `★ ${row.average}`)];
    }),
    board("Жанры", "Голоса в голосованиях за жанры", genres, (row) => [link(`/catalog?genre=${encodeURIComponent(row.name)}`, null, row.name), el("strong", null, String(row.votes))]),
    board("Читатели", "Прочитанные главы, только открытые профили", readers, (row) => {
      const name = el("span", "user-chip");
      name.append(avatar(row, "avatar-sm"), link(`/users/${encodeURIComponent(row.username)}`, null, row.name));
      return [name, el("small", null, `${row.chapters} гл. · ${row.completed} дочитано`)];
    })
  );
  body.replaceChildren(grid);
}

// ==================== ВКЛАДКИ ====================

function renderActions() {
  actions.replaceChildren();
  if (current === "polls" && user?.isModerator) actions.append(button("＋ Голосование", "primary-btn", newPoll));
  if (current === "tournaments") actions.append(button("＋ Турнир", "primary-btn", newTournament));
}

const VIEWS = { polls: showPolls, tournaments: showTournaments, leaders: showLeaders };

function open(name) {
  const tab = name.startsWith("tournament-") ? "tournaments" : name.startsWith("poll-") ? "polls" : name;
  current = TABS.includes(tab) ? tab : "polls";
  tabs.forEach((node) => {
    node.setAttribute("aria-selected", String(node.dataset.tab === current));
    node.tabIndex = node.dataset.tab === current ? 0 : -1;
  });
  if (!name.startsWith("tournament-") && !name.startsWith("poll-")) history.replaceState(null, "", `#${current}`);
  renderActions();
  VIEWS[current]();
}

tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => open(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const next = tabs[(i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    next.focus();
    open(next.dataset.tab);
  });
});

async function init() {
  user = await initHeader();
  await getMe();
  open(location.hash.slice(1));
}

init();
