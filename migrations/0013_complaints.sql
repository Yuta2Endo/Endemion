-- Жалобы правообладателей с формы /copyright. Разбирает администратор в /admin
CREATE TABLE complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Кто подаёт жалобу и куда ответить
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  -- Чьи права нарушены и какое произведение
  rightholder TEXT NOT NULL,
  work TEXT NOT NULL,
  -- JSON-массив ссылок на страницы Endemion
  links TEXT NOT NULL,
  description TEXT NOT NULL,
  -- new — не разобрана, resolved — материал удалён, rejected — отклонена
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'resolved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX complaints_status ON complaints(status, created_at);
