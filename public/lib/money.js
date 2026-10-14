/** Số ngày nắm giữ giữa 2 ngày ISO (làm tròn xuống). */
export function daysBetween(fromIso, toIso) {
  const a = Date.parse(fromIso + "T00:00:00Z");
  const b = Date.parse(toIso + "T00:00:00Z");
  return Math.floor((b - a) / 86400000);
}
