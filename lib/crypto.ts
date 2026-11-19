import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken() {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function matches(left: string, right: string) {
  const buffer = Buffer.from(left);
  const other = Buffer.from(right);
  return buffer.length === other.length && timingSafeEqual(buffer, other);
}

function key(purpose: string) {
  const secret = Buffer.from(process.env.SESSION_SECRET || "", "base64url");
  if (secret.length < 32) throw new Error("SESSION_SECRET must encode at least 32 random bytes");
  return createHmac("sha256", secret).update(purpose).digest();
}

export function seal(value: string, sessionId: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("github-token"), nonce);
  cipher.setAAD(Buffer.from(sessionId));
  return Buffer.concat([nonce, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64url");
}

export function unseal(value: string, sessionId: string) {
  const encrypted = Buffer.from(value, "base64url");
  const cipher = createDecipheriv("aes-256-gcm", key("github-token"), encrypted.subarray(0, 12));
  cipher.setAAD(Buffer.from(sessionId));
  cipher.setAuthTag(encrypted.subarray(-16));
  return Buffer.concat([cipher.update(encrypted.subarray(12, -16)), cipher.final()]).toString("utf8");
}

export function sign(value: object) {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", key("approval")).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verify<T>(signed: string): T | null {
  const [encoded, signature, extra] = signed.split(".");
  if (!encoded || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", key("approval")).update(encoded).digest("base64url");
  if (!matches(signature, expected)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
