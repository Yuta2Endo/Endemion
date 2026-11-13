// Состояние резервных копий для проверки извне: свежий ли локальный бэкап и прошла ли выгрузка в S3.
// Отдельный модуль, чтобы это можно было проверить тестами без поднятия сервера.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Только автоматические бэкапы вида endemion-2026-11-13T19-19-27.sqlite: в каталоге могут лежать
// ручные архивы (endemion-pre-cleanup-...), которые не должны считаться свежей копией.
export const NAME = /^endemion-\d{4}-\d{2}-\d{2}T[\d-]+\.sqlite$/;
// Отчёт о последней попытке выгрузки в S3. Пишется при каждом бэкапе, перезаписывается.
export const REMOTE_REPORT = "last-remote.json";

/** Время самого свежего бэкапа в каталоге (мс) или 0, если файлов нет */
export function latestBackupTime(dir) {
  try {
    // Сортируем по времени изменения, а не по имени: имя ручного архива может оказаться «больше» автоматического
    let newest = 0;
    for (const name of readdirSync(dir).filter((name) => NAME.test(name))) {
      newest = Math.max(newest, statSync(path.join(dir, name)).mtimeMs);
    }
    return newest;
  } catch {
    return 0;
  }
}

/** Последний отчёт о выгрузке в S3 или null, если выгрузка не настроена */
export function readRemoteReport(dir) {
  try {
    const data = JSON.parse(readFileSync(path.join(dir, REMOTE_REPORT), "utf8"));
    return typeof data === "object" && data ? data : null;
  } catch {
    return null;
  }
}

/**
 * Проверка бэкапов. ok - свежий локальный файл есть и последняя выгрузка в S3 не падала.
 * Если выгрузка не настроена (нет отчёта), проверяется только локальный файл.
 *
 * @param {string} dir каталог с бэкапами
 * @param {{ now?: number, maxAgeHours?: number }} [options]
 */
export function backupStatus(dir, { now = Date.now(), maxAgeHours = 30 } = {}) {
  const latest = latestBackupTime(dir);
  const problems = [];
  let ageHours = null;

  if (!latest) {
    problems.push("нет ни одного файла бэкапа");
  } else {
    ageHours = (now - latest) / 3_600_000;
    if (ageHours > maxAgeHours) problems.push(`последний бэкап ${Math.round(ageHours)} ч назад`);
  }

  const remote = readRemoteReport(dir);
  if (remote) {
    if (remote.ok === false) {
      problems.push(`выгрузка в хранилище не удалась: ${remote.error || "без описания"}`);
    } else if (remote.at) {
      const remoteAge = (now - Date.parse(remote.at)) / 3_600_000;
      if (remoteAge > maxAgeHours) problems.push(`последняя выгрузка в хранилище ${Math.round(remoteAge)} ч назад`);
    }
  }

  return {
    ok: problems.length === 0,
    latest: latest ? new Date(latest).toISOString() : null,
    ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
    maxAgeHours,
    remote: remote ? { at: remote.at || null, ok: remote.ok !== false, key: remote.key || null } : null,
    problems
  };
}
