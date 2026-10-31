// Настройки своего сервера (Docker + VPS) из переменных окружения. Описание переменных — в .env.example

import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
export const DB_FILE = path.join(DATA_DIR, "endemion.sqlite");
export const BACKUP_DIR = path.join(DATA_DIR, "backups");
export const FILES_DIR = path.join(DATA_DIR, "files");
export const PUBLIC_DIR = path.join(ROOT, "public");
export const MIGRATIONS_DIR = path.join(ROOT, "migrations");
