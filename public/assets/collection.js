// Страница подборки: описание, автор, тайтлы с заметками. Владелец может менять, убирать тайтлы и удалять подборку

import {
  api, button, checkbox, el, errorBox, field, formValue, getLibrary, initHeader, input, openDialog, reportContent,
  stateBox, textarea, titleCard, titlePicker, toast, toggleFavorite, userLink
} from "./app.js";
import { mountComments } from "./comments.js";

const id = Number(document.querySelector("main").dataset.collectionId);
const head = document.querySelector("#collectionHead");
const items = document.querySelector("#collectionItems");

let user = null;
let library = new Map();
let data = null;

function render() {
  const { collection } = data;
  document.title = `${collection.name} — подборка | ENDEMION`;
  document.querySelector("#crumb").textContent = collection.name;
  head.removeAttribute("aria-busy");
  const top = el("div", "page-head");
  const text = el("div");
  text.append(el("div", "eyebrow", collection.featured ? "Выбор редакции" : "Подборка читателя"), el("h1", null, collection.name));
  if (collection.description) text.append(el("p", "section-text", collection.description));
  const meta = el("div", "thread-meta");
  meta.append(userLink(collection.author, { size: "avatar-sm" }), el("span", null, `${data.items.length} тайтлов`));
  if (!collection.isPublic) meta.append(el("span", "tag", "Скрыта: видите только вы"));
  text.append(meta);
  const actions = el("div", "section-actions");
  if (collection.canEdit) {
    actions.append(button("Изменить", "ghost-btn", edit), button("Удалить", "danger-btn", remove));
  } else if (user) {
    actions.append(button("Пожаловаться", "ghost-btn", () => reportContent("collection", id)));
  }
  top.append(text, actions);
  head.replaceChildren(top);
  if (collection.canEdit) {
    const picker = titlePicker({ placeholder: "Добавить тайтл в подборку…", onPick: add });
    head.append(picker.root);
  }

  if (!data.items.length) {
    items.replaceChildren(stateBox({ icon: "🎨", text: collection.canEdit ? "Добавьте первый тайтл через поиск выше." : "В подборке пока пусто." }));
    return;
  }
  items.replaceChildren(...data.items.map(({ title, note }) => {
    const extra = [];
    if (note) extra.push(el("p", "t-desc", `«${note}»`));
    if (collection.canEdit) {
      extra.push(button("Убрать", "link-btn small", async () => {
        const result = await api(`/api/collections/${id}/items`, { method: "DELETE", body: { titleId: title.id } });
        if (!result.ok) return toast(result.data?.error || "Не удалось убрать.");
        data.items = data.items.filter((item) => item.title.id !== title.id);
        render();
      }));
      extra.at(-1).classList.add("t-raised");
    }
    return titleCard(title, { library: library.get(title.id), onFavorite: toggleFavorite, extra });
  }));
}

async function add(title) {
  const result = await api(`/api/collections/${id}/items`, { method: "PUT", body: { titleId: title.id } });
  if (!result.ok) return toast(result.data?.error || "Не удалось добавить.");
  toast(`«${title.title}» добавлен.`);
  await load();
}

async function edit() {
  const { collection } = data;
  await openDialog({
    title: "Изменить подборку",
    build(form) {
      form.append(
        field("Название", input("name", { value: collection.name, maxLength: 80 })),
        field("Описание", textarea("description", { value: collection.description, maxLength: 1000, rows: 3 })),
        checkbox("isPublic", "Открытая: её видят все", collection.isPublic)
      );
    },
    async onSubmit(form) {
      const result = await api(`/api/collections/${id}`, {
        method: "PATCH",
        body: { name: formValue(form, "name"), description: formValue(form, "description"), isPublic: formValue(form, "isPublic") }
      });
      if (!result.ok) return result.data?.error || "Не удалось сохранить.";
      data.collection = result.data.collection;
      render();
      return null;
    }
  });
}

async function remove() {
  if (!confirm("Удалить подборку? Тайтлы останутся в каталоге и на вашей полке.")) return;
  const result = await api(`/api/collections/${id}`, { method: "DELETE" });
  if (!result.ok) return toast(result.data?.error || "Не удалось удалить.");
  location.href = "/community#collections";
}

async function load() {
  const result = await api(`/api/collections/${id}`);
  if (result.status === 404) {
    head.replaceChildren(stateBox({ icon: "🔭", title: "Подборка не найдена", text: "Её удалили или сделали скрытой.", action: { href: "/community#collections", text: "Все подборки" } }));
    items.replaceChildren();
    document.querySelector("#commentsTitle").closest("section").hidden = true;
    return false;
  }
  if (!result.ok) {
    head.replaceChildren(errorBox(result.data?.error || "Подборка не загрузилась.", load));
    return false;
  }
  data = result.data;
  render();
  return true;
}

async function init() {
  user = await initHeader();
  library = await getLibrary();
  if (!(await load())) return;
  if (data.collection.isPublic) {
    mountComments(document.querySelector("#comments"), { targetType: "collection", targetId: id, placeholder: "Что скажете о подборке?" });
  } else {
    document.querySelector("#comments").replaceChildren(el("p", "muted small", "Комментарии доступны в открытых подборках."));
  }
}

init();
