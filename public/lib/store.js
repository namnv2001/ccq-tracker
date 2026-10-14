// Truy vấn + sửa trên DB dạng JSON: { funds, transactions, nav: {code: {date: nav}}, fees: {code: tiers} }

import { valuation, remainingLots } from "./calc.js";

const txOf = (db, code) => db.transactions.filter((t) => t.fundCode === code);

/** Các lô còn nắm giữ của 1 quỹ = lô BUY sau khi trừ các lệnh SELL theo FIFO. */
export function buyLots(db, code) {
  const txs = txOf(db, code);
  const buys = txs.filter((t) => t.type === "BUY").map(({ id, tradeDate, units, nav }) => ({ id, tradeDate, units, nav }));
  const sells = txs.filter((t) => t.type === "SELL");
  return remainingLots(buys, sells);
}

export function transactions(db, code) {
  return txOf(db, code).sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || b.id - a.id);
}

export function navHistory(db, code) {
  return Object.entries(db.nav[code] ?? {})
    .map(([navDate, nav]) => ({ navDate, nav }))
    .sort((a, b) => a.navDate.localeCompare(b.navDate));
}

export function latestNav(db, code) {
  return navHistory(db, code).at(-1)?.nav ?? null;
}

export function navByDate(db, code, date) {
  return db.nav[code]?.[date] ?? null;
}

export function feeTiers(db, code) {
  return [...(db.fees[code] ?? [])].sort((a, b) => a.minDays - b.minDays);
}

export function portfolioSummary(db) {
  const funds = db.funds.map((f) => {
    const lots = buyLots(db, f.code);
    const v = valuation(lots, latestNav(db, f.code) ?? 0);
    return { code: f.code, name: f.name, assetType: f.assetType, ...v, lots: lots.length };
  });
  const invested = funds.reduce((s, f) => s + f.invested, 0);
  const currentValue = funds.reduce((s, f) => s + f.currentValue, 0);
  const pnl = currentValue - invested;
  return { invested, currentValue, pnl, pnlPct: invested > 0 ? pnl / invested : 0, funds };
}

function parseTx(db, b) {
  if (!db.funds.some((f) => f.code === b.fundCode)) throw new Error(`Không tìm thấy quỹ ${b.fundCode}`);
  const nav = Number(b.nav);
  let units = b.units != null ? Number(b.units) : NaN;
  let amount = b.amount != null ? Number(b.amount) : NaN;
  if (!Number.isFinite(units) && Number.isFinite(amount) && nav > 0) units = amount / nav;
  if (!Number.isFinite(amount) && Number.isFinite(units)) amount = units * nav;
  if (!b.tradeDate || !Number.isFinite(nav) || !Number.isFinite(units)) {
    throw new Error("Thiếu tradeDate/nav và (units hoặc amount)");
  }
  return {
    fundCode: b.fundCode,
    type: b.type === "SELL" ? "SELL" : "BUY",
    tradeDate: b.tradeDate,
    units,
    nav,
    amount,
    fee: Number(b.fee) || 0,
    note: b.note ?? null,
  };
}

function rememberNav(db, tx) {
  db.nav[tx.fundCode] ??= {};
  db.nav[tx.fundCode][tx.tradeDate] ??= tx.nav;
}

export function addTx(db, body) {
  const tx = parseTx(db, body);
  const id = Math.max(0, ...db.transactions.map((t) => t.id)) + 1;
  db.transactions.push({ id, ...tx });
  rememberNav(db, tx);
  return id;
}

export function updateTx(db, id, body) {
  const i = db.transactions.findIndex((t) => t.id === id);
  if (i < 0) throw new Error(`Không tìm thấy giao dịch ${id}`);
  const tx = parseTx(db, body);
  db.transactions[i] = { id, ...tx };
  rememberNav(db, tx);
}

export function deleteTx(db, id) {
  db.transactions = db.transactions.filter((t) => t.id !== id);
}

export function setFees(db, code, tiers) {
  db.fees[code] = tiers.map((t) => ({
    minDays: Number(t.minDays),
    maxDays: t.maxDays == null ? null : Number(t.maxDays),
    rate: Number(t.rate),
  }));
}
