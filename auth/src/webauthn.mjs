// Ключ доступа (WebAuthn) без библиотек. Браузер отдаёт публичный ключ в SPKI,
// сервер проверяет challenge, адрес сайта и подпись входа. Приватный ключ на сервер не попадает

import { createHash, createPublicKey, createVerify, randomBytes, timingSafeEqual } from "node:crypto";

const fromB64u = (value) => Buffer.from(String(value || ""), "base64url");

export const newChallenge = () => randomBytes(32).toString("base64url");

export function registrationOptions({ rpId, rpName, userId, userName, challenge }) {
  return {
    challenge,
    rp: { id: rpId, name: rpName },
    user: { id: Buffer.from(userId).toString("base64url"), name: userName, displayName: userName },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    timeout: 60_000,
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    attestation: "none"
  };
}

export function authenticationOptions(rpId, challenge) {
  return { challenge, rpId, timeout: 60_000, userVerification: "preferred" };
}

/** SPKI только P-256 или RSA от 2048 бит. Чужой формат ключа не сохраняется */
export function acceptPublicKey(spki) {
  try {
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    const details = key.asymmetricKeyDetails || {};
    if (key.asymmetricKeyType === "ec" && details.namedCurve === "prime256v1") return key;
    if (key.asymmetricKeyType === "rsa" && details.modulusLength >= 2048) return key;
  } catch {
    // Не ключ
  }
  return null;
}

function clientData(json, type, expectedChallenge, origin) {
  let data;
  try {
    data = JSON.parse(fromB64u(json).toString("utf8"));
  } catch {
    return null;
  }
  if (data.type !== type || data.origin !== origin || typeof data.challenge !== "string") return null;
  const actual = fromB64u(data.challenge);
  const expected = fromB64u(expectedChallenge);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return data;
}

function authenticator(bytes, rpId) {
  if (bytes.length < 37) return null;
  if (!timingSafeEqual(bytes.subarray(0, 32), createHash("sha256").update(rpId).digest())) return null;
  if ((bytes[32] & 0x01) === 0) return null;
  return { signCount: bytes.readUInt32BE(33) };
}

function signed(authenticatorData, clientDataJSON) {
  return Buffer.concat([fromB64u(authenticatorData), createHash("sha256").update(fromB64u(clientDataJSON)).digest()]);
}

/** Регистрация: challenge и сайт совпали, ключ допустимый. Подпись устройства проверяется при следующем входе */
export function verifyRegistration(body, { challenge, origin, rpId }) {
  if (!clientData(body.clientDataJSON, "webauthn.create", challenge, origin)) return null;
  const auth = authenticator(fromB64u(body.authenticatorData), rpId);
  const key = acceptPublicKey(fromB64u(body.publicKey));
  if (!auth || !key || !/^[A-Za-z0-9_-]{16,512}$/.test(String(body.id || ""))) return null;
  return { id: String(body.id), publicKey: fromB64u(body.publicKey).toString("base64url"), signCount: auth.signCount };
}

/** Вход: подпись сделана тем ключом, который сохранили, и счётчик не откатился */
export function verifyAuthentication(body, { challenge, origin, rpId, publicKey, signCount }) {
  if (!clientData(body.clientDataJSON, "webauthn.get", challenge, origin)) return false;
  const auth = authenticator(fromB64u(body.authenticatorData), rpId);
  const key = acceptPublicKey(fromB64u(publicKey));
  if (!auth || !key) return false;
  if (signCount !== 0 && auth.signCount !== 0 && auth.signCount <= signCount) return false;
  const verify = createVerify(key.asymmetricKeyType === "rsa" ? "RSA-SHA256" : "sha256");
  verify.update(signed(body.authenticatorData, body.clientDataJSON));
  try {
    return verify.verify(key, fromB64u(body.signature)) ? auth.signCount : false;
  } catch {
    return false;
  }
}
