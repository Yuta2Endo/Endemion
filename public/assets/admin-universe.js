// Раздел админки «Вселенные»: организации, локации, события и связи для карты вселенной произведения.
// Персонажи, создатели и связанные произведения берутся из каталога, здесь их не редактируют.
// Права проверяет сервер (functions/api/adminUniverse.js): только администратор

import { api, button, el, field, input, link, openDialog, textarea, toast } from "./app.js";

const $ = (selector) => document.querySelector(selector);

export const ENTITY_LABELS = { organization: "Организация", location: "Локация", event: "Событие" };
export const RELATION_LABELS = {
  friend: "Дружба", family: "Родство", enemy: "Вражда", rival: "Соперничество", mentor: "Наставник",
  member_of: "Состоит в", participates_in: "Участвует в", located_in: "Находится в"
};
const SPOILER_LABELS = ["Не спойлер", "Спойлер", "Финал"];

// Какие концы допустимы — так же, как RELATION_RULES на сервере: в форме видны только подходящие варианты
const PEOPLE = ["character"];
const SIDES = ["character", "organization"];
const RULES = {
  friend: [PEOPLE, PEOPLE], family: [PEOPLE, PEOPLE], mentor: [PEOPLE, PEOPLE],
  enemy: [SIDES, SIDES], rival: [SIDES, SIDES],
  member_of: [SIDES, ["organization"]], participates_in: [SIDES, ["event"]],
  located_in: [["character", "organization", "event", "location"], ["location"]]
};

let state = null;

function setMessage(text, success = false) {
  const node = $("#universeMessage");
  node.textContent = text;
  node.classList.toggle("success", success);
}

function select(name, options, value) {
  const node = el("select", "select");
  node.name = name;
  for (const [optionValue, label] of options) node.append(new Option(label, optionValue));
  if (value !== undefined && value !== null) node.value = String(value);
  return node;
}

/** Число из поля формы. Пусто — null, не число — NaN: сервер ответит понятной ошибкой */
const numberOrNull = (value) => (value.trim() === "" ? null : Number(value));

function commonControls(form, item, descriptionMax) {
  const units = state.entry.units;
  form.append(
    field("Источник", input("reference", { value: item?.reference || "", maxLength: 300, required: true }),
      "Обязательно: эпизод, глава, официальный справочник. Без источника запись не сохранится."),
    field("Описание", textarea("description", { value: item?.description || "", maxLength: descriptionMax, rows: 3 })),
    field(units ? `С какого эпизода известно (1–${units})` : "С какого эпизода известно", input("episode", { value: item?.episode ?? "", maxLength: 6 }),
      "Пусто — запись не привязана к эпизоду. Тогда зрителю без спойлеров её видно только с уровнем «Не спойлер»."),
    field("Уровень спойлера", select("spoilerLevel", SPOILER_LABELS.map((label, i) => [i, label]), item?.spoilerLevel ?? 0))
  );
}

function commonValues(form) {
  return {
    reference: form.elements.reference.value,
    description: form.elements.description.value,
    episode: numberOrNull(form.elements.episode.value),
    spoilerLevel: Number(form.elements.spoilerLevel.value)
  };
}

async function editEntity(entity = null, type = "organization") {
  const kindOf = entity?.type || type;
  await openDialog({
    title: entity ? `${ENTITY_LABELS[kindOf]}: правка` : "Новая запись",
    submitText: entity ? "Сохранить" : "Добавить",
    build(form) {
      if (!entity) form.append(field("Тип", select("type", Object.entries(ENTITY_LABELS), kindOf)));
      form.append(field("Название", input("title", { value: entity?.title || "", maxLength: 200, required: true })));
      commonControls(form, entity, 2000);
      const order = field("Порядок в хронологии мира", input("chronologyOrder", { value: entity?.chronologyOrder ?? "", maxLength: 8 }),
        "Только у событий. Меньше — раньше. Пусто — неизвестно.");
      form.append(order);
      const typeSelect = form.elements.type;
      const sync = () => (order.hidden = (typeSelect?.value || kindOf) !== "event");
      typeSelect?.addEventListener("change", sync);
      sync();
    },
    async onSubmit(form) {
      const type = form.elements.type?.value || kindOf;
      const body = {
        ...commonValues(form), title: form.elements.title.value,
        chronologyOrder: type === "event" ? numberOrNull(form.elements.chronologyOrder.value) : null
      };
      const result = entity
        ? await api(`/api/admin/universe/entities/${entity.id}`, { method: "PUT", body })
        : await api(`/api/admin/universe/${state.entry.kind}/${state.entry.id}/entities`, { method: "POST", body: { ...body, type } });
      if (!result.ok) return result.data?.error || "Не удалось сохранить.";
      toast(entity ? "Запись сохранена" : "Запись добавлена");
      await reload();
      return null;
    }
  });
}

/** Варианты конца связи: персонажи произведения и записи нужных типов */
function endOptions(kinds) {
  const options = [];
  if (kinds.includes("character")) {
    for (const character of state.characters) options.push([`character:${character.id}`, `Персонаж: ${character.name}`]);
  }
  for (const entity of state.entities) {
    if (kinds.includes(entity.type)) options.push([`entity:${entity.id}`, `${ENTITY_LABELS[entity.type]}: ${entity.title}`]);
  }
  return options;
}

const parseEnd = (value) => {
  const [type, id] = String(value).split(":");
  return { type, id: Number(id) };
};

async function editRelation(relation = null) {
  await openDialog({
    title: relation ? `Связь: ${RELATION_LABELS[relation.type]}` : "Новая связь",
    submitText: relation ? "Сохранить" : "Добавить",
    build(form) {
      if (relation) {
        form.append(el("p", "admin-hint", `${endName(relation.from)} → ${endName(relation.to)}. Концы и тип не меняются: удалите связь и создайте новую.`));
      } else {
        const typeSelect = select("type", Object.entries(RELATION_LABELS), "friend");
        const fromBox = el("div");
        const toBox = el("div");
        const fill = () => {
          const [from, to] = RULES[typeSelect.value];
          fromBox.replaceChildren(field("Откуда", select("from", endOptions(from))));
          toBox.replaceChildren(field("Куда", select("to", endOptions(to))));
        };
        typeSelect.addEventListener("change", fill);
        form.append(field("Тип связи", typeSelect), fromBox, toBox);
        fill();
      }
      commonControls(form, relation, 300);
    },
    async onSubmit(form) {
      const body = commonValues(form);
      let result;
      if (relation) {
        result = await api(`/api/admin/universe/relations/${relation.id}`, { method: "PUT", body });
      } else {
        if (!form.elements.from.value || !form.elements.to.value) return "Выберите оба конца связи. Нужные записи сначала добавьте выше.";
        result = await api(`/api/admin/universe/${state.entry.kind}/${state.entry.id}/relations`, {
          method: "POST",
          body: { ...body, type: form.elements.type.value, from: parseEnd(form.elements.from.value), to: parseEnd(form.elements.to.value) }
        });
      }
      if (!result.ok) return result.data?.error || "Не удалось сохранить.";
      toast(relation ? "Связь сохранена" : "Связь добавлена");
      await reload();
      return null;
    }
  });
}

function endName(end) {
  if (end.type === "character") return state.characters.find((item) => item.id === end.id)?.name || `персонаж #${end.id}`;
  return state.entities.find((item) => item.id === end.id)?.title || `запись #${end.id}`;
}

function meta(item) {
  const parts = [];
  if (item.episode) parts.push(`с эпизода ${item.episode}`);
  if (item.chronologyOrder !== null && item.chronologyOrder !== undefined) parts.push(`хронология: ${item.chronologyOrder}`);
  parts.push(SPOILER_LABELS[item.spoilerLevel], `источник: ${item.reference}`);
  return parts.join(" · ");
}

function itemRow(title, tag, item, onEdit, onDelete) {
  const row = el("li", "admin-plain-item");
  const info = el("div", "admin-plain-info");
  const head = el("div", "admin-title-head");
  head.append(el("strong", null, title), el("span", `admin-tag${item.spoilerLevel ? " is-moderator" : ""}`, tag));
  info.append(head, el("small", "admin-hint", meta(item)));
  if (item.description) info.append(el("p", "admin-hint", item.description));
  const actions = el("div", "admin-actions");
  actions.append(button("Изменить", "secondary-button", onEdit), button("Удалить", "danger-button", onDelete));
  row.append(info, actions);
  return row;
}

async function remove(url, question, done) {
  if (!confirm(question)) return;
  const result = await api(url, { method: "DELETE" });
  if (!result.ok) return toast(result.data?.error || "Не удалось удалить.");
  toast(done);
  await reload();
}

function render() {
  const box = $("#universeEditor");
  const { entry, entities, relations, limits } = state;
  const head = el("div", "admin-title-head");
  head.append(
    el("strong", null, entry.title),
    link(`${entry.url}#universe`, "admin-more-link", "Открыть карту на сайте")
  );
  const summary = el("p", "admin-hint",
    `Персонажей из каталога: ${state.characters.length} · эпизодов: ${entry.units || "неизвестно"} · записей: ${entities.length}/${limits.entities} · связей: ${relations.length}/${limits.relations}`);

  const entityList = el("ul", "admin-plain-list");
  if (!entities.length) entityList.append(el("li", "admin-empty", "Записей нет. Карта показывает только данные каталога."));
  entityList.append(...entities.map((entity) => itemRow(entity.title, ENTITY_LABELS[entity.type], entity, () => editEntity(entity),
    () => remove(`/api/admin/universe/entities/${entity.id}`, `Удалить «${entity.title}» и все её связи?`, "Запись удалена"))));

  const relationList = el("ul", "admin-plain-list");
  if (!relations.length) relationList.append(el("li", "admin-empty", "Связей нет."));
  relationList.append(...relations.map((relation) => itemRow(`${endName(relation.from)} → ${endName(relation.to)}`, RELATION_LABELS[relation.type], relation,
    () => editRelation(relation), () => remove(`/api/admin/universe/relations/${relation.id}`, "Удалить связь?", "Связь удалена"))));

  box.replaceChildren(
    head, summary,
    el("p", "admin-subheading", "Организации, локации и события"),
    button("Добавить запись", "main-button", () => editEntity()),
    entityList,
    el("p", "admin-subheading", "Связи"),
    button("Добавить связь", "main-button", () => editRelation()),
    relationList
  );
}

async function reload() {
  const kind = $("#universeKind").value;
  const id = $("#universeId").value.trim();
  const box = $("#universeEditor");
  if (!/^\d{1,9}$/.test(id)) {
    setMessage("Укажите номер произведения из адреса страницы.");
    return;
  }
  setMessage("Загружаем…");
  const result = await api(`/api/admin/universe/${kind}/${id}`);
  if (!result.ok) {
    state = null;
    box.replaceChildren();
    setMessage(result.data?.error || "Не удалось загрузить.");
    return;
  }
  state = result.data;
  setMessage("");
  history.replaceState(null, "", `#universe/${kind}-${id}`);
  render();
}

/** Раздел открыт. #universe/anime-16498 сразу открывает произведение */
export function loadUniverse(param = "") {
  const match = /^(anime|manga)-(\d{1,9})$/.exec(param || "");
  if (match) {
    $("#universeKind").value = match[1];
    $("#universeId").value = match[2];
    reload();
  }
}

export function initUniverseAdmin() {
  $("#universeForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    reload();
  });
}
