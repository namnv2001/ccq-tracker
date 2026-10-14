// Client API fmarket. Không test được trong sandbox (mạng chặn) — verify trên máy có internet.
// Thiết kế phòng thủ: parse linh hoạt, lỗi rõ ràng, không chặn luồng nhập tay.

const BASE = "https://api.fmarket.vn";
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "Accept-Language": "vi",
  Origin: "https://fmarket.vn",
  Referer: "https://fmarket.vn/",
};

export type FmarketProduct = { id: number; code: string; name: string; nav: number | null; navDate: string | null };

/** Lấy danh sách quỹ + NAV mới nhất, dùng để map code -> productId. */
export async function fetchProducts(): Promise<FmarketProduct[]> {
  const res = await fetch(`${BASE}/res/products/filter`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      types: ["NEW_FUND", "TRADING_FUND"],
      issuerIds: [],
      sortOrder: "DESC",
      sortField: "navTo6Months",
      page: 1,
      pageSize: 200,
      isIpo: false,
      fundAssetTypes: [],
      bondRemainPeriods: [],
      searchField: "",
      isBuyByReward: false,
      thirdAppIds: [],
    }),
  });
  if (!res.ok) throw new Error(`fmarket filter HTTP ${res.status}`);
  const json: any = await res.json();
  const rows: any[] = json?.data?.rows ?? json?.data ?? [];
  return rows.map((r) => ({
    id: r.id,
    code: r.shortName ?? r.code ?? "",
    name: r.name ?? r.shortName ?? "",
    nav: typeof r.nav === "number" ? r.nav : null,
    navDate: r.navDate ?? r.lastNAVDate ?? null,
  }));
}

/** Phân giải productId cho danh sách code (vd DCDS/VESAF/DCBF). */
export async function resolveProductIds(codes: string[]): Promise<Record<string, FmarketProduct>> {
  const products = await fetchProducts();
  const map: Record<string, FmarketProduct> = {};
  for (const code of codes) {
    const hit = products.find((p) => p.code?.toUpperCase() === code.toUpperCase());
    if (hit) map[code] = hit;
  }
  return map;
}

export type NavPoint = { navDate: string; nav: number };

/** Lịch sử NAV theo productId trong khoảng ngày (ISO yyyy-mm-dd). */
export async function fetchNavHistory(productId: number, fromIso: string, toIso: string): Promise<NavPoint[]> {
  const res = await fetch(`${BASE}/res/product/get-nav-history`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      productId,
      fromDate: fromIso.replace(/-/g, ""),
      toDate: toIso.replace(/-/g, ""),
      isAllData: 0,
    }),
  });
  if (!res.ok) throw new Error(`fmarket nav-history HTTP ${res.status}`);
  const json: any = await res.json();
  const rows: any[] = json?.data ?? [];
  return rows
    .map((r) => ({ navDate: normalizeDate(r.navDate ?? r.date), nav: Number(r.nav) }))
    .filter((p) => p.navDate && Number.isFinite(p.nav));
}

function normalizeDate(v: any): string {
  if (v == null) return "";
  if (typeof v === "number") return new Date(v).toISOString().slice(0, 10);
  const s = String(v);
  // hỗ trợ "yyyy-mm-dd", "dd/mm/yyyy", ISO datetime
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const vn = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (vn) return `${vn[3]}-${vn[2].padStart(2, "0")}-${vn[1].padStart(2, "0")}`;
  return s.slice(0, 10);
}
