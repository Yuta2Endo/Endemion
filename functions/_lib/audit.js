// Журнал действий администраторов: кто, когда и что изменил. Записи хранятся год

const KEEP_DAYS = 365;

/** Группы для фильтра журнала: действие попадает в группу по началу кода */
export const AUDIT_GROUPS = {
  titles: ["title.", "cover."],
  chapters: ["chapter.", "pages."],
  complaints: ["complaint."],
  users: ["user."]
};

/**
 * Запись в журнал. Ошибка записи не отменяет уже сделанное действие: иначе администратор увидел бы ошибку,
 * повторил действие и, например, удалил бы следующую главу
 */
export async function audit(env, actor, action, target) {
  try {
    await env.DB.prepare("INSERT INTO audit_log (actor_id, actor_name, action, target) VALUES (?, ?, ?, ?)")
      .bind(actor.id, actor.name, action, target)
      .run();
    // Изредка чистим старые записи, отдельный планировщик для этого не нужен
    if (Math.random() < 0.02) {
      await env.DB.prepare("DELETE FROM audit_log WHERE created_at < datetime('now', ?)").bind(`-${KEEP_DAYS} days`).run();
    }
  } catch (err) {
    console.error("Запись в журнал действий не сохранена:", err.message);
  }
}

/** Тайтл в записи журнала: «Название» (#5) */
export function titleLabel(title) {
  return `«${title.title}» (#${title.id})`;
}

/** Пользователь в записи журнала: только id, без имени и почты. Запись остаётся и после удаления аккаунта */
export function userLabel(user) {
  return `пользователь #${user.id}`;
}

export function toAuditEntry(row) {
  return { id: row.id, actorName: row.actor_name, action: row.action, target: row.target, createdAt: row.created_at };
}
