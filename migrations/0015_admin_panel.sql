-- Админка: блокировка пользователей и журнал действий администраторов.
-- blocked_at — когда администратор заблокировал аккаунт; NULL — не заблокирован. Заблокированный не может войти
ALTER TABLE users ADD COLUMN blocked_at TEXT;

-- Кто из администраторов, когда и что изменил. Имя сохраняется на момент действия: запись остаётся,
-- даже если аккаунт администратора потом удалят. Записи старше года удаляются (functions/_lib/audit.js)
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  -- title.create, chapter.delete, user.block... Подписи для админки — ACTION_LABELS в public/assets/admin.js
  action TEXT NOT NULL,
  -- Что изменено, например «Название» (#5), глава 3. Данных пользователей здесь нет, только id
  target TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX audit_log_created ON audit_log(created_at);
-- Регистрации за 7 и 30 дней в сводке
CREATE INDEX users_created ON users(created_at);
