// Biểu phí bán theo bậc thời gian nắm giữ (thuần, dễ test)
// FeeTier = { minDays (bao gồm), maxDays (không bao gồm; null = vô hạn), rate (0.01 = 1%) }

/** Tra phí bán theo số ngày nắm giữ. Trả về bậc khớp đầu tiên, mặc định 0. */
export function feeRateForHoldingDays(tiers, days) {
  for (const t of tiers) {
    const okMin = days >= t.minDays;
    const okMax = t.maxDays == null || days < t.maxDays;
    if (okMin && okMax) return t.rate;
  }
  return 0;
}
