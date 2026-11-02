// Хранилище картинок с тем же интерфейсом, что у Cloudflare R2: get, head, put, delete, list.
// Без настроек S3 файлы лежат в data/files на диске сервера. С S3_BUCKET — в S3-совместимом хранилище
// (Selectel, Yandex Object Storage, VK Cloud и другие)

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
const CONTENT_TYPES = Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type]));

// ==================== ДИСК ====================

/**
 * Файлы в одной папке. Имя файла — ключ целиком (косые черты закодированы) и расширение по типу картинки,
 * поэтому выйти за пределы папки через ключ нельзя, а тип файла не нужно хранить отдельно
 */
function diskStorage(dir) {
  mkdirSync(dir, { recursive: true });
  const base = (key) => encodeURIComponent(key).replaceAll(".", "%2E");
  const variants = (key) => [...Object.keys(CONTENT_TYPES), "bin"].map((ext) => path.join(dir, `${base(key)}.${ext}`));
  const find = (key) => variants(key).find((file) => existsSync(file)) || null;

  function describe(key, file) {
    const stat = statSync(file);
    const ext = path.extname(file).slice(1);
    return {
      key,
      size: stat.size,
      httpEtag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
      httpMetadata: { contentType: CONTENT_TYPES[ext] || "application/octet-stream" }
    };
  }

  function remove(key) {
    for (const file of variants(key)) rmSync(file, { force: true });
  }

  return {
    async get(key) {
      const file = find(key);
      return file ? { ...describe(key, file), body: Readable.toWeb(createReadStream(file)) } : null;
    },
    async head(key) {
      const file = find(key);
      return file ? describe(key, file) : null;
    },
    async put(key, data, options = {}) {
      const ext = EXTENSIONS[options.httpMetadata?.contentType] || "bin";
      const target = path.join(dir, `${base(key)}.${ext}`);
      // Через временный файл: читатель никогда не получит наполовину записанную картинку
      const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(temp, Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data));
      remove(key);
      renameSync(temp, target);
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) remove(key);
    },
    /** @param {{ prefix?: string, cursor?: string, limit?: number }} [options] */
    async list({ prefix = "", cursor, limit = 1000 } = {}) {
      const keys = readdirSync(dir)
        .filter((name) => !name.includes(".tmp-"))
        .map((name) => ({ name, key: decodeURIComponent(name.slice(0, name.lastIndexOf("."))) }))
        .filter(({ key }) => key.startsWith(prefix))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const start = cursor ? keys.findIndex(({ key }) => key > cursor) : 0;
      const page = start < 0 ? [] : keys.slice(start, start + limit);
      const truncated = start >= 0 && start + limit < keys.length;
      return {
        objects: page.map(({ name, key }) => ({ key, size: statSync(path.join(dir, name)).size })),
        truncated,
        cursor: truncated ? page.at(-1).key : undefined
      };
    }
  };
}

// ==================== S3 ====================

/**
 * Клиент S3 по переменным с приставкой prefix: S3_ (картинки) или BACKUP_S3_ (резервные копии базы).
 * Возвращает null, если бакет не задан, и бросает ошибку, если бакет задан без ключей
 */
export async function createS3Client(env, prefix) {
  const bucket = env[`${prefix}BUCKET`];
  if (!bucket) return null;
  for (const name of ["ACCESS_KEY_ID", "SECRET_ACCESS_KEY"]) {
    if (!env[`${prefix}${name}`]) throw new Error(`Задан ${prefix}BUCKET, но не задан ${prefix}${name}.`);
  }
  const sdk = await import("@aws-sdk/client-s3");
  const client = new sdk.S3Client({
    region: env[`${prefix}REGION`] || "auto",
    endpoint: env[`${prefix}ENDPOINT`] || undefined,
    forcePathStyle: env[`${prefix}FORCE_PATH_STYLE`] === "1",
    credentials: { accessKeyId: env[`${prefix}ACCESS_KEY_ID`], secretAccessKey: env[`${prefix}SECRET_ACCESS_KEY`] },
    // Новые контрольные суммы SDK поддерживают не все S3-совместимые хранилища
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  });
  return { client, bucket, sdk };
}

async function s3Storage(env) {
  const { client, bucket, sdk } = await createS3Client(env, "S3_");
  const { GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = sdk;
  const Bucket = bucket;
  const missing = (err) => err?.name === "NoSuchKey" || err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404;

  return {
    async get(key) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return {
          key,
          size: object.ContentLength,
          httpEtag: object.ETag,
          httpMetadata: { contentType: object.ContentType },
          body: object.Body.transformToWebStream()
        };
      } catch (err) {
        if (missing(err)) return null;
        throw err;
      }
    },
    async head(key) {
      try {
        const object = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { key, size: object.ContentLength, httpEtag: object.ETag, httpMetadata: { contentType: object.ContentType } };
      } catch (err) {
        if (missing(err)) return null;
        throw err;
      }
    },
    async put(key, data, options = {}) {
      const Body = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body, ContentType: options.httpMetadata?.contentType }));
    },
    // По одному файлу, по 10 одновременно: пакетное удаление требует контрольных сумм, которые поддерживают не все хранилища
    async delete(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (let i = 0; i < list.length; i += 10) {
        await Promise.all(list.slice(i, i + 10).map((Key) => client.send(new DeleteObjectCommand({ Bucket, Key }))));
      }
    },
    /** @param {{ prefix?: string, cursor?: string, limit?: number }} [options] */
    async list({ prefix = "", cursor, limit = 1000 } = {}) {
      const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: cursor, MaxKeys: limit }));
      return {
        objects: (page.Contents || []).map((object) => ({ key: object.Key, size: object.Size })),
        truncated: Boolean(page.IsTruncated),
        cursor: page.NextContinuationToken
      };
    }
  };
}

export async function createStorage(env, filesDir) {
  return env.S3_BUCKET ? s3Storage(env) : diskStorage(filesDir);
}
