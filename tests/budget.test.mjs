// Бюджет ассетов: размер не должен расти незаметно.
// Считаем gzip — именно столько отдаёт Caddy с `encode gzip`.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

const DIR = join(process.cwd(), "public", "assets");
const LIMITS = {
  file: 12 * 1024,
  js: 120 * 1024,
  css: 70 * 1024
};

const files = readdirSync(DIR).filter((name) => /\.(?:js|css)$/.test(name));

/** @param {string} name */
function gzipSize(name) {
  return gzipSync(readFileSync(join(DIR, name))).length;
}

/** @param {string} extension */
function total(extension) {
  return files.filter((name) => name.endsWith(extension)).reduce((sum, name) => sum + gzipSize(name), 0);
}

test("каждый файл ассетов укладывается в бюджет", () => {
  for (const name of files) {
    const size = gzipSize(name);
    assert.ok(size <= LIMITS.file, `${name}: ${size} байт в gzip, бюджет ${LIMITS.file}`);
  }
});

test("суммарный вес JS и CSS в бюджете", () => {
  assert.ok(total(".js") <= LIMITS.js, `JS: ${total(".js")} байт в gzip, бюджет ${LIMITS.js}`);
  assert.ok(total(".css") <= LIMITS.css, `CSS: ${total(".css")} байт в gzip, бюджет ${LIMITS.css}`);
});
