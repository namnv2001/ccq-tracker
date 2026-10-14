import { test } from "node:test";
import assert from "node:assert/strict";
import { avgCost, avgCostAfterBuy, valuation, estimateSell, remainingLots, holding } from "../public/lib/calc.js";
import { feeRateForHoldingDays } from "../public/lib/fees.js";
import { daysBetween } from "../public/lib/money.js";

type Lot = { tradeDate: string; units: number; nav: number };
type FeeTier = { minDays: number; maxDays: number | null; rate: number };

const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("daysBetween", () => {
  assert.equal(daysBetween("2025-01-01", "2025-01-31"), 30);
  assert.equal(daysBetween("2024-01-01", "2025-01-01"), 366); // năm nhuận
});

test("avgCost gia quyền", () => {
  const lots: Lot[] = [
    { tradeDate: "2025-01-01", units: 10, nav: 100 },
    { tradeDate: "2025-02-01", units: 30, nav: 200 },
  ];
  approx(avgCost(lots), (10 * 100 + 30 * 200) / 40); // 175
});

test("valuation lãi/lỗ", () => {
  const lots: Lot[] = [{ tradeDate: "2025-01-01", units: 100, nav: 100 }];
  const v = valuation(lots, 90);
  approx(v.invested, 10000);
  approx(v.currentValue, 9000);
  approx(v.pnl, -1000);
  approx(v.pnlPct, -0.1);
});

test("avgCostAfterBuy hạ giá vốn khi mua giá thấp", () => {
  const r = avgCostAfterBuy(100, 100, 5000, 50); // mua 100 CCQ @50
  approx(r.buyUnits, 100);
  approx(r.after.units, 200);
  approx(r.after.avgCost, 75);
  approx(r.avgDelta, -25);
});

test("feeRateForHoldingDays theo bậc", () => {
  const tiers: FeeTier[] = [
    { minDays: 0, maxDays: 365, rate: 0.01 },
    { minDays: 365, maxDays: 730, rate: 0.005 },
    { minDays: 730, maxDays: null, rate: 0 },
  ];
  approx(feeRateForHoldingDays(tiers, 10), 0.01);
  approx(feeRateForHoldingDays(tiers, 400), 0.005);
  approx(feeRateForHoldingDays(tiers, 800), 0);
});

test("estimateSell FIFO + phí theo lô", () => {
  const lots: Lot[] = [
    { tradeDate: "2023-01-01", units: 100, nav: 100 }, // giữ lâu -> 0%
    { tradeDate: "2026-07-01", units: 100, nav: 120 }, // mới -> 1%
  ];
  const tiers: FeeTier[] = [
    { minDays: 0, maxDays: 365, rate: 0.01 },
    { minDays: 730, maxDays: null, rate: 0 },
  ];
  // bán 150 @ nav 130, asOf 2026-07-23: lấy 100 từ lô cũ (0%) + 50 từ lô mới (1%)
  const e = estimateSell(lots, 150, 130, tiers, "2026-07-23");
  assert.equal(e.perLot.length, 2);
  approx(e.perLot[0].feeRate, 0);
  approx(e.perLot[1].feeRate, 0.01);
  approx(e.grossProceeds, 150 * 130); // 19500
  approx(e.totalFee, 50 * 130 * 0.01); // 65
  approx(e.netProceeds, 19500 - 65);
  approx(e.costBasis, 100 * 100 + 50 * 120); // 16000
  approx(e.profit, 19500 - 65 - 16000);
});

test("remainingLots trừ SELL theo FIFO", () => {
  const buys: Lot[] = [
    { tradeDate: "2025-01-01", units: 100, nav: 100 },
    { tradeDate: "2025-02-01", units: 100, nav: 200 },
  ];
  const rem = remainingLots(buys, [{ tradeDate: "2025-03-01", units: 150 }]);
  // bán 150: hết lô 1 (100) + 50 của lô 2 -> còn 50 @200
  assert.equal(rem.length, 1);
  approx(rem[0].units, 50);
  approx(rem[0].nav, 200);
  approx(holding(rem).units, 50);
});

test("estimateSell chặn bán quá số CCQ", () => {
  const lots: Lot[] = [{ tradeDate: "2025-01-01", units: 10, nav: 100 }];
  assert.throws(() => estimateSell(lots, 20, 100, [], "2026-01-01"));
});
