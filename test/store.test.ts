import { test } from "node:test";
import assert from "node:assert/strict";
import * as store from "../public/lib/store.js";
import { deriveKey, encrypt, decrypt, newSalt } from "../public/lib/crypto.js";

const emptyDb = () => ({
  funds: [{ code: "DCDS", name: "DC", issuer: "DC", assetType: "STOCK", fmarketProductId: null }],
  transactions: [] as any[],
  nav: { DCDS: { "2025-06-01": 120 } } as Record<string, Record<string, number>>,
  fees: { DCDS: [{ minDays: 0, maxDays: null, rate: 0 }] },
});

test("thêm/sửa/xoá giao dịch -> portfolioSummary đúng", () => {
  const db = emptyDb();
  const a = store.addTx(db, { fundCode: "DCDS", type: "BUY", tradeDate: "2025-01-01", nav: 100, amount: 10000 });
  const b = store.addTx(db, { fundCode: "DCDS", type: "BUY", tradeDate: "2025-02-01", nav: 200, units: 50 });
  assert.equal(b, a + 1);
  assert.equal(db.nav.DCDS["2025-01-01"], 100);

  store.addTx(db, { fundCode: "DCDS", type: "SELL", tradeDate: "2025-03-01", nav: 150, units: 100 });
  let s = store.portfolioSummary(db);
  assert.equal(s.funds[0].units, 50);
  assert.equal(s.invested, 50 * 200);
  assert.equal(s.currentValue, 50 * 120);

  store.updateTx(db, b, { fundCode: "DCDS", type: "BUY", tradeDate: "2025-02-01", nav: 200, units: 60 });
  assert.equal(store.portfolioSummary(db).funds[0].units, 60);

  store.deleteTx(db, a);
  assert.equal(store.transactions(db, "DCDS").length, 2);
  assert.throws(() => store.addTx(db, { fundCode: "XXX", tradeDate: "2025-01-01", nav: 1, units: 1 }));
  assert.throws(() => store.addTx(db, { fundCode: "DCDS", tradeDate: "", nav: 1, units: 1 }));
});

test("nav ngày giao dịch không ghi đè NAV đã có", () => {
  const db = emptyDb();
  store.addTx(db, { fundCode: "DCDS", type: "BUY", tradeDate: "2025-06-01", nav: 999, units: 1 });
  assert.equal(store.navByDate(db, "DCDS", "2025-06-01"), 120);
});

test("mã hoá -> giải mã ra đúng object, IV mới mỗi lần", async () => {
  const salt = newSalt();
  const key = await deriveKey("correct horse battery staple", salt);
  const db = emptyDb();
  const f1 = await encrypt(db, key, salt);
  const f2 = await encrypt(db, key, salt);
  assert.notEqual(f1.iv, f2.iv);
  assert.deepEqual(await decrypt(f1, key), db);
  const wrong = await deriveKey("wrong", salt);
  await assert.rejects(decrypt(f1, wrong));
});
