// /healthz/backup: монитор должен узнать, что копии перестали обновляться
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backupStatus } from "../server/backupStatus.mjs";

/** Каталог с «бэкапами» на время одного теста */
function withDir(run) {
  const dir = mkdtempSync(path.join(tmpdir(), "endemion-backup-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("бэкапов нет: проверка падает с понятной причиной", () => {
  withDir((dir) => {
    const status = backupStatus(dir);
    assert.equal(status.ok, false);
    assert.equal(status.latest, null);
    assert.match(status.problems.join(" "), /нет ни одного файла бэкапа/);
  });
});

test("свежая копия считается нормальной, старая — нет", () => {
  withDir((dir) => {
    const file = path.join(dir, "endemion-2026-11-14T03-00-00.sqlite");
    writeFileSync(file, "sqlite");
    assert.equal(backupStatus(dir, { maxAgeHours: 30 }).ok, true);

    // Сдвигаем время файла на двое суток назад
    const old = (Date.now() - 48 * 3_600_000) / 1000;
    utimesSync(file, old, old);
    const stale = backupStatus(dir, { maxAgeHours: 30 });
    assert.equal(stale.ok, false);
    assert.match(stale.problems.join(" "), /последний бэкап 48 ч назад/);
  });
});

test("отчёт о выгрузке: ошибка хранилища видна, успешная выгрузка — нет", () => {
  withDir((dir) => {
    writeFileSync(path.join(dir, "endemion-2026-11-14T03-00-00.sqlite"), "sqlite");

    writeFileSync(path.join(dir, "last-remote.json"), JSON.stringify({ at: new Date().toISOString(), ok: false, error: "SignatureDoesNotMatch" }));
    const failed = backupStatus(dir);
    assert.equal(failed.ok, false);
    assert.match(failed.problems.join(" "), /SignatureDoesNotMatch/);

    writeFileSync(path.join(dir, "last-remote.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, key: "s3://bucket/backups/x.sqlite" }));
    const ok = backupStatus(dir);
    assert.equal(ok.ok, true);
    assert.equal(ok.remote?.key, "s3://bucket/backups/x.sqlite");
  });
});

test("старая успешная выгрузка тоже поднимает тревогу", () => {
  withDir((dir) => {
    writeFileSync(path.join(dir, "endemion-2026-11-14T03-00-00.sqlite"), "sqlite");
    const at = new Date(Date.now() - 72 * 3_600_000).toISOString();
    writeFileSync(path.join(dir, "last-remote.json"), JSON.stringify({ at, ok: true }));
    const status = backupStatus(dir, { maxAgeHours: 30 });
    assert.equal(status.ok, false);
    assert.match(status.problems.join(" "), /выгрузка в хранилище 72 ч назад/);
  });
});
