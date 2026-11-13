// Состояние резервных копий для проверки извне: свежий ли локальный бэкап и прошла ли выгрузка в S3.
// Отдельный модуль, чтобы это можно было проверить тестами без поднятия сервера.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const NAME = /^endemion-.+\.sqlite$/;
// Отчёт о последней попытке выгрузки в S3. Пишется при каждом бэкапе, перезаписывается.
export const REMOTE_REPORT = "last-remote.json";

/** Время самого свежего бэкапа в каталоге (мс) или 0, если файлов нет */
export function latestBackupTime(dir) {
  try {
    const names = readdirSync(dir).filter((name) => NAME.test(name)).sort();
    return names.length ? statSync(path.join(dir, names.at(-1))).mtimeMs : 0;
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
