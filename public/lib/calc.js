// Tính toán danh mục: giá vốn TB, định giá, ước tính bán FIFO. Thuần, dễ test.
// Lot = { id?, tradeDate: "yyyy-mm-dd", units, nav (giá mua / CCQ) }

import { feeRateForHoldingDays } from "./fees.js";
import { daysBetween } from "./money.js";

/**
 * Áp các lệnh SELL vào lô BUY theo FIFO, trả về các lô còn nắm giữ (units đã trừ).
 * Dùng để holdings/định giá luôn phản ánh cả lệnh bán.
 */
export function remainingLots(buys, sells) {
  const lots = buys
    .slice()
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
    .map((l) => ({ ...l }));
  let toSell = sells.reduce((s, x) => s + x.units, 0);
  for (const lot of lots) {
    if (toSell <= 1e-9) break;
    const take = Math.min(lot.units, toSell);
    lot.units -= take;
    toSell -= take;
  }
  return lots.filter((l) => l.units > 1e-9);
}

/** Giá vốn trung bình gia quyền theo số CCQ. */
export function avgCost(lots) {
  const units = lots.reduce((s, l) => s + l.units, 0);
  if (units <= 0) return 0;
  const cost = lots.reduce((s, l) => s + l.units * l.nav, 0);
  return cost / units;
}

/** Tổng số CCQ và vốn đã đầu tư (chỉ tính các lô mua đang giữ). */
export function holding(lots) {
  const units = lots.reduce((s, l) => s + l.units, 0);
  const invested = lots.reduce((s, l) => s + l.units * l.nav, 0);
  return { units, invested, avgCost: units > 0 ? invested / units : 0 };
}

/** Định giá hiện thời theo NAV mới nhất. */
export function valuation(lots, currentNav) {
  const { units, invested, avgCost } = holding(lots);
  const currentValue = units * currentNav;
  const pnl = currentValue - invested;
  const pnlPct = invested > 0 ? pnl / invested : 0;
  return { units, invested, avgCost, currentNav, currentValue, pnl, pnlPct };
}

/** Giá vốn TB trước và sau khi mua thêm — hỗ trợ quyết định bình quân giá. */
export function avgCostAfterBuy(currentUnits, currentAvg, buyAmount, buyNav) {
  const buyUnits = buyNav > 0 ? buyAmount / buyNav : 0;
  const newUnits = currentUnits + buyUnits;
  const newInvested = currentUnits * currentAvg + buyAmount;
  const newAvg = newUnits > 0 ? newInvested / newUnits : 0;
  return {
    buyUnits,
    before: { units: currentUnits, avgCost: currentAvg },
    after: { units: newUnits, avgCost: newAvg },
    avgDelta: newAvg - currentAvg,
  };
}

/**
 * Ước tính bán `sellUnits` CCQ theo phương pháp FIFO (bán lô mua sớm nhất trước).
 * Phí tính theo thời gian nắm giữ của từng lô.
 */
export function estimateSell(lots, sellUnits, currentNav, tiers, asOf) {
  const ordered = [...lots].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const available = ordered.reduce((s, l) => s + l.units, 0);
  if (sellUnits > available + 1e-9) {
    throw new Error(`Chỉ có ${available.toFixed(2)} CCQ, không thể bán ${sellUnits}.`);
  }

  let remaining = sellUnits;
  const perLot = [];
  for (const lot of ordered) {
    if (remaining <= 1e-9) break;
    const take = Math.min(lot.units, remaining);
    remaining -= take;
    const holdingDays = daysBetween(lot.tradeDate, asOf);
    const feeRate = feeRateForHoldingDays(tiers, holdingDays);
    const gross = take * currentNav;
    const fee = gross * feeRate;
    const net = gross - fee;
    const costBasis = take * lot.nav;
    perLot.push({
      tradeDate: lot.tradeDate,
      unitsSold: take,
      holdingDays,
      feeRate,
      costBasis,
      gross,
      fee,
      net,
      profit: net - costBasis,
    });
  }

  const grossProceeds = perLot.reduce((s, r) => s + r.gross, 0);
  const totalFee = perLot.reduce((s, r) => s + r.fee, 0);
  const netProceeds = perLot.reduce((s, r) => s + r.net, 0);
  const costBasis = perLot.reduce((s, r) => s + r.costBasis, 0);
  const profit = netProceeds - costBasis;
  return {
    sellUnits,
    currentNav,
    grossProceeds,
    totalFee,
    netProceeds,
    costBasis,
    profit,
    profitPct: costBasis > 0 ? profit / costBasis : 0,
    perLot,
  };
}
