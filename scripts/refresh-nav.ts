// Cập nhật NAV mới nhất + lịch sử 1 năm từ fmarket vào public/db.enc.json.
// Dùng: CCQ_PASSPHRASE=... npm run refresh-nav   (GitHub Actions chạy hằng ngày)

import { readFileSync, writeFileSync } from "node:fs";
import { deriveKey, encrypt, decrypt } from "../public/lib/crypto.js";
import { resolveProductIds, fetchNavHistory } from "./fmarket.ts";

const DB_FILE = new URL("../public/db.enc.json", import.meta.url);
const pass = process.env.CCQ_PASSPHRASE;
if (!pass) throw new Error("Thiếu biến môi trường CCQ_PASSPHRASE");

const file = JSON.parse(readFileSync(DB_FILE, "utf8"));
const key = await deriveKey(pass, file.salt);
const db = await decrypt(file, key);

const today = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
const map = await resolveProductIds(db.funds.map((f: any) => f.code));

let changed = false;
const setNav = (code: string, date: string, nav: number) => {
  db.nav[code] ??= {};
  if (db.nav[code][date] !== nav) { db.nav[code][date] = nav; changed = true; }
};

for (const f of db.funds) {
  const p = map[f.code];
  if (!p) { console.log(`${f.code}: không tìm thấy trên fmarket`); continue; }
  if (f.fmarketProductId !== p.id) { f.fmarketProductId = p.id; changed = true; }
  if (p.nav != null) setNav(f.code, p.navDate || today, p.nav);
  try {
    const hist = await fetchNavHistory(p.id, from, today);
    for (const pt of hist) setNav(f.code, pt.navDate, pt.nav);
    console.log(`${f.code}: NAV ${p.nav} (${p.navDate ?? today}), ${hist.length} điểm lịch sử`);
  } catch (e: any) {
    console.log(`${f.code}: NAV ${p.nav}, lịch sử lỗi: ${e.message}`);
  }
}

// Chỉ ghi khi có NAV mới: mã hoá lại luôn ra IV mới nên file sẽ đổi dù dữ liệu không đổi.
if (changed) {
  writeFileSync(DB_FILE, JSON.stringify(await encrypt(db, key, file.salt)) + "\n");
  console.log("Đã ghi public/db.enc.json");
} else {
  console.log("Không có NAV mới");
}
