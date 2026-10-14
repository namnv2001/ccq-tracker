// File mã hoá: { v: 1, salt, iv, ct } (base64). PBKDF2-SHA256 → AES-GCM-256.

const ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();
// Không dùng String.fromCharCode(...bytes): spread mảng lớn vượt giới hạn số đối số.
const toB64 = (buf) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const newSalt = () => toB64(crypto.getRandomValues(new Uint8Array(16)));

export async function deriveKey(passphrase, saltB64) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64(saltB64), iterations: ITERATIONS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// IV mới mỗi lần: dùng lại IV với cùng key là phá vỡ AES-GCM.
export async function encrypt(obj, key, saltB64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  return { v: 1, salt: saltB64, iv: toB64(iv), ct: toB64(ct) };
}

export async function decrypt(file, key) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(file.iv) }, key, fromB64(file.ct));
  return JSON.parse(dec.decode(pt));
}
