// Оглавление для длинных текстовых документов: собирается из заголовков статьи.
// Скрипт внешний (CSP не разрешает встроенные), поэтому разметка документа остаётся чистой.

const container = document.querySelector(".doc, .post-page .rich-text");

if (container) {
  const headings = [...container.querySelectorAll(":scope > h2, :scope > h3")];

  // Короткий документ в оглавлении не нуждается
  if (headings.length >= 3) {
    const nav = document.createElement("nav");
    nav.className = "doc-toc";
    nav.setAttribute("aria-labelledby", "docTocTitle");

    const title = document.createElement("h2");
    title.id = "docTocTitle";
    title.className = "doc-toc-title";
    title.textContent = "Содержание";

    const list = document.createElement("ol");
    for (const [index, heading] of headings.entries()) {
      if (!heading.id) heading.id = `doc-section-${index + 1}`;
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;
      item.append(link);
      list.append(item);
    }

    nav.append(title, list);
    // Внутри документа оглавление встаёт после заголовка и даты, иначе — перед статьёй
    const anchor = container.querySelector(".doc-updated") || container.querySelector("h1");
    if (anchor) container.insertBefore(nav, anchor.nextSibling);
    else container.parentElement.insertBefore(nav, container);
  }
}
