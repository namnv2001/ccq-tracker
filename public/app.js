// ---------- helpers ----------
import * as store from "./lib/store.js";
import { estimateSell, avgCostAfterBuy, holding } from "./lib/calc.js";
import { deriveKey, encrypt, decrypt } from "./lib/crypto.js";

const REPO = "namnv2001/ccq-tracker";
const BRANCH = "master";
const DB_FILE = "public/db.enc.json";
const pat = () => localStorage.getItem("ccq-pat");

async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...opts,
    cache: "no-store", // API trả Cache-Control max-age=60: không tắt thì reload ngay sau khi sửa sẽ ra file + sha cũ
    headers: { Authorization: `Bearer ${pat()}`, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) {
    const e = new Error((await r.json().catch(() => ({}))).message || `GitHub HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.status === 204 ? null : r.json();
}

let db, key, salt, sha;

async function unlock(file) {
  if (key && salt === file.salt) return decrypt(file, key);
  for (;;) {
    const pass = sessionStorage.getItem("ccq-pass") ?? prompt("Passphrase giải mã dữ liệu:");
    if (pass == null) throw new Error("Cần passphrase để xem dữ liệu.");
    try {
      const k = await deriveKey(pass, file.salt);
      const data = await decrypt(file, k);
      [key, salt] = [k, file.salt];
      sessionStorage.setItem("ccq-pass", pass);
      return data;
    } catch {
      sessionStorage.removeItem("ccq-pass");
      alert("Sai passphrase.");
    }
  }
}

// Có token: đọc thẳng từ repo (bản mới nhất + sha để ghi). Không có: đọc bản đã deploy, chỉ xem.
async function loadDb() {
  let file;
  if (pat()) {
    const r = await gh(`/contents/${DB_FILE}?ref=${BRANCH}`);
    sha = r.sha;
    file = JSON.parse(atob(r.content.replace(/\n/g, "")));
  } else {
    file = await (await fetch("db.enc.json", { cache: "no-store" })).json();
  }
  db = await unlock(file);
  state.summary = store.portfolioSummary(db);
}

// Sửa trên bản sao, commit thành công mới nhận — lỗi giữa chừng không làm lệch dữ liệu đang hiển thị.
async function mutate(message, fn) {
  if (!pat()) throw new Error("Chưa có GitHub token — bấm nút Token để nhập.");
  const next = structuredClone(db);
  const result = fn(next);
  const file = await encrypt(next, key, salt);
  try {
    const r = await gh(`/contents/${DB_FILE}`, {
      method: "PUT",
      body: JSON.stringify({ message, content: btoa(JSON.stringify(file)), sha, branch: BRANCH }),
    });
    sha = r.content.sha;
  } catch (e) {
    if (e.status === 409 || e.status === 422) {
      await loadDb();
      throw new Error("Dữ liệu trên GitHub vừa thay đổi, đã tải lại — vui lòng thao tác lại.");
    }
    throw e;
  }
  db = next;
  state.summary = store.portfolioSummary(db);
  return result;
}

const vnd = (n) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + " đ";
const num = (n, d = 2) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n || 0);
const pct = (x) => (x >= 0 ? "+" : "") + num(x * 100, 2) + "%";
const cls = (x) => (x >= 0 ? "up" : "down");
// nhóm nghìn kiểu vi-VN ("." nghìn, "," thập phân); giữ nguyên phần thập phân đang gõ
const groupVN = (raw) => {
  const neg = String(raw).trim().startsWith("-");
  const s = String(raw).replace(/[^\d,]/g, "");
  const [int, ...rest] = s.split(",");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-" : "") + grouped + (s.includes(",") ? "," + rest.join("") : "");
};
const parseNum = (v) => Number(String(v).replace(/\./g, "").replace(",", ".")) || 0;
// định dạng khi gõ cho ô .fmt, giữ vị trí con trỏ theo số chữ số phía trước
document.addEventListener("input", (e) => {
  const t = e.target;
  if (!t.classList || !t.classList.contains("fmt")) return;
  const before = t.value.slice(0, t.selectionStart).replace(/[^\d,]/g, "").length;
  t.value = groupVN(t.value);
  let i = 0, kept = 0;
  while (i < t.value.length && kept < before) { if (/[\d,]/.test(t.value[i])) kept++; i++; }
  t.setSelectionRange(i, i);
});
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
const COLORS = ["#4d8bff", "#24c38a", "#f2a33c", "#a06bff", "#f2555a", "#3ccfdc"];

let charts = [];
function clearCharts() { charts.forEach((c) => c.destroy()); charts = []; }

const app = document.getElementById("app");
let state = { tab: "dashboard", summary: null };
let editingId = null; // id giao dịch đang sửa, null = đang thêm mới
let editingFee = 0;   // giữ lại phí sẵn có (form không có ô phí) để không bị xoá khi sửa

// ---------- tabs ----------
document.getElementById("nav").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-tab]"); if (!a) return;
  state.tab = a.dataset.tab;
  document.querySelectorAll("#nav a").forEach((n) => n.classList.toggle("active", n === a));
  render();
});

document.getElementById("btn-refresh").addEventListener("click", async (e) => {
  const btn = e.target; btn.disabled = true;
  try {
    if (!pat()) throw new Error("Chưa có GitHub token — bấm nút Token để nhập.");
    await gh("/actions/workflows/pages.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: BRANCH }) });
    alert("Đã kích hoạt cập nhật NAV trên GitHub Actions — khoảng 2 phút sau tải lại trang.");
  } catch (err) {
    alert("Không kích hoạt được cập nhật NAV:\n" + err.message + "\n\nBạn vẫn có thể nhập NAV thủ công qua tab Giao dịch.");
  } finally { btn.disabled = false; }
});

document.getElementById("btn-token").addEventListener("click", () => {
  const t = prompt("GitHub fine-grained token (chỉ repo ccq-tracker, quyền Contents + Actions read/write). Để trống để xoá:", pat() ?? "");
  if (t == null) return;
  if (t.trim()) localStorage.setItem("ccq-pat", t.trim()); else localStorage.removeItem("ccq-pat");
  state.summary = null; render();
});

// ---------- render dispatch ----------
async function render() {
  clearCharts();
  try {
    if (!state.summary) await loadDb();
    ({ dashboard: renderDashboard, transactions: renderTransactions, sell: renderSell, buy: renderBuy, fees: renderFees }[state.tab])();
  } catch (e) {
    app.innerHTML = `<div class="panel down">Lỗi: ${e.message}</div>`;
  }
}

// ---------- dashboard ----------
function renderDashboard() {
  const s = state.summary;
  app.innerHTML = `
    <div class="cards">
      <div class="card"><div class="label">Tổng đầu tư</div><div class="value">${vnd(s.invested)}</div></div>
      <div class="card"><div class="label">Giá trị hiện thời</div><div class="value">${vnd(s.currentValue)}</div></div>
      <div class="card"><div class="label">Lãi / Lỗ</div><div class="value ${cls(s.pnl)}">${vnd(s.pnl)}</div></div>
      <div class="card"><div class="label">Lợi nhuận</div><div class="value ${cls(s.pnlPct)}">${pct(s.pnlPct)}</div></div>
    </div>
    <div class="grid2">
      <div class="panel"><h3>Phân bổ danh mục (theo giá trị)</h3><canvas id="pie"></canvas></div>
      <div class="panel"><h3>Lãi / lỗ theo quỹ</h3><canvas id="bar"></canvas></div>
    </div>
    <div class="panel">
      <h3>Chi tiết các quỹ</h3>
      <table><thead><tr>
        <th>Quỹ</th><th>Số CCQ</th><th>Giá vốn TB</th><th>NAV hiện tại</th><th>Vốn</th><th>Hiện thời</th><th>Lãi/Lỗ</th><th>%</th>
      </tr></thead><tbody>
        ${s.funds.map((f) => `<tr>
          <td><b>${f.code}</b> <span class="muted">${f.assetType}</span></td>
          <td>${num(f.units)}</td><td>${vnd(f.avgCost)}</td><td>${vnd(f.currentNav)}</td>
          <td>${vnd(f.invested)}</td><td>${vnd(f.currentValue)}</td>
          <td class="${cls(f.pnl)}">${vnd(f.pnl)}</td><td class="${cls(f.pnlPct)}">${pct(f.pnlPct)}</td>
        </tr>`).join("")}
      </tbody></table>
    </div>
    <div class="panel">
      <h3>Biến động NAV theo thời gian</h3>
      <div class="row"><label class="field">Quỹ<select id="navFund">${s.funds.map((f) => `<option>${f.code}</option>`).join("")}</select></label></div>
      <canvas id="navchart"></canvas>
    </div>`;

  charts.push(new Chart(document.getElementById("pie"), {
    type: "doughnut",
    data: { labels: s.funds.map((f) => f.code), datasets: [{ data: s.funds.map((f) => f.currentValue), backgroundColor: COLORS }] },
    options: { plugins: { legend: { labels: { color: "#e6ecf5" } } } },
  }));
  charts.push(new Chart(document.getElementById("bar"), {
    type: "bar",
    data: { labels: s.funds.map((f) => f.code), datasets: [{ data: s.funds.map((f) => f.pnl), backgroundColor: s.funds.map((f) => (f.pnl >= 0 ? "#24c38a" : "#f2555a")) }] },
    options: { plugins: { legend: { display: false } }, scales: axes() },
  }));

  const navFund = document.getElementById("navFund");
  navFund.addEventListener("change", () => drawNav(navFund.value));
  drawNav(s.funds[0].code);
}

function drawNav(code) {
  const hist = store.navHistory(db, code);
  const txs = store.transactions(db, code);
  const canvas = document.getElementById("navchart");
  const old = Chart.getChart(canvas); if (old) old.destroy();
  charts.push(new Chart(canvas, {
    type: "line",
    data: {
      labels: hist.map((h) => h.navDate),
      datasets: [
        { label: "NAV", data: hist.map((h) => h.nav), borderColor: "#4d8bff", pointRadius: 0, tension: .2 },
        { label: "Giá mua", data: hist.map((h) => { const t = txs.find((x) => x.tradeDate === h.navDate); return t ? t.nav : null; }),
          borderColor: "#f2a33c", backgroundColor: "#f2a33c", showLine: false, pointRadius: 4 },
      ],
    },
    options: { plugins: { legend: { labels: { color: "#e6ecf5" } } }, scales: axes() },
  }));
}

function axes() {
  return { x: { ticks: { color: "#8b97ad", maxTicksLimit: 8 }, grid: { color: "#2c3852" } },
           y: { ticks: { color: "#8b97ad" }, grid: { color: "#2c3852" } } };
}

// ---------- transactions ----------
async function renderTransactions() {
  const codes = state.summary.funds.map((f) => f.code);
  app.innerHTML = `
    <div class="panel">
      <h3>Thêm giao dịch</h3>
      <div class="row">
        <label class="field">Quỹ<select id="t-fund">${codes.map((c) => `<option>${c}</option>`).join("")}</select></label>
        <label class="field">Loại<select id="t-type"><option value="BUY">Mua</option><option value="SELL">Bán</option></select></label>
        <label class="field">Ngày<input type="date" id="t-date" value="${new Date().toISOString().slice(0,10)}"></label>
        <label class="field">NAV (giá/CCQ)<input type="text" inputmode="decimal" class="fmt" id="t-nav" placeholder="vd 90.000"></label>
        <label class="field">Số tiền<input type="text" inputmode="decimal" class="fmt" id="t-amount" placeholder="để trống nếu nhập CCQ"></label>
        <label class="field">Số CCQ<input type="text" inputmode="decimal" class="fmt" id="t-units" placeholder="để trống nếu nhập tiền"></label>
        <button id="t-add">Thêm</button>
        <button id="t-cancel" class="ghost" style="display:none">Huỷ</button>
      </div>
      <div class="muted">Nhập <b>một trong hai</b>: Số tiền hoặc Số CCQ — cái còn lại tự tính từ NAV.</div>
      <div class="muted" id="t-nav-hint"></div>
    </div>
    <div class="panel">
      <h3>Lịch sử giao dịch <select id="t-filter">${codes.map((c) => `<option>${c}</option>`).join("")}</select></h3>
      <div id="t-list"></div>
    </div>`;

  const filter = document.getElementById("t-filter");
  filter.addEventListener("change", () => listTx(filter.value));
  document.getElementById("t-add").addEventListener("click", addTx);
  document.getElementById("t-cancel").addEventListener("click", cancelEdit);
  document.getElementById("t-fund").addEventListener("change", fillNavByDate);
  document.getElementById("t-date").addEventListener("change", fillNavByDate);
  cancelEdit();
  listTx(codes[0]);
  fillNavByDate();
}

const fmtIn = (v) => groupVN(String(v).replace(".", ","));

function startEdit(r, code) {
  editingId = r.id;
  editingFee = r.fee || 0;
  document.getElementById("t-fund").value = code;
  document.getElementById("t-type").value = r.type;
  document.getElementById("t-date").value = r.tradeDate;
  document.getElementById("t-nav").value = fmtIn(r.nav);
  document.getElementById("t-amount").value = fmtIn(r.amount);
  document.getElementById("t-units").value = fmtIn(r.units);
  document.getElementById("t-add").textContent = "Cập nhật";
  document.getElementById("t-cancel").style.display = "";
  document.getElementById("t-nav-hint").textContent = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cancelEdit() {
  editingId = null;
  document.getElementById("t-add").textContent = "Thêm";
  document.getElementById("t-cancel").style.display = "none";
  ["t-nav", "t-amount", "t-units"].forEach((id) => (document.getElementById(id).value = ""));
}

// Lấy NAV theo ngày từ DB nếu có; nếu không, để trống cho user tự nhập.
function fillNavByDate() {
  const code = document.getElementById("t-fund").value;
  const date = document.getElementById("t-date").value;
  const navEl = document.getElementById("t-nav");
  const hint = document.getElementById("t-nav-hint");
  if (!date) return;
  const nav = store.navByDate(db, code, date);
  if (nav != null) {
    navEl.value = groupVN(String(nav).replace(".", ","));
    hint.textContent = `NAV ngày ${date} lấy từ dữ liệu đã có.`;
  } else {
    navEl.value = "";
    hint.textContent = `Chưa có NAV ngày ${date} — vui lòng nhập tay.`;
  }
}

function listTx(code) {
  const rows = store.transactions(db, code);
  document.getElementById("t-list").innerHTML = rows.length === 0 ? `<div class="muted">Chưa có giao dịch.</div>` : `
    <table><thead><tr><th>Ngày</th><th>Loại</th><th>NAV</th><th>Số CCQ</th><th>Số tiền</th><th>Phí</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr>
      <td>${r.tradeDate}</td><td>${r.type === "BUY" ? "Mua" : "Bán"}</td>
      <td>${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 4 }).format(r.nav || 0)} đ</td><td>${num(r.units)}</td><td>${vnd(r.amount)}</td><td>${vnd(r.fee)}</td>
      <td><button class="edit" data-id="${r.id}">Sửa</button> <button class="del" data-id="${r.id}">Xoá</button></td>
    </tr>`).join("")}
    </tbody></table>`;
  document.querySelectorAll("#t-list .edit").forEach((b) => b.addEventListener("click", () =>
    startEdit(rows.find((r) => r.id === Number(b.dataset.id)), code)));
  document.querySelectorAll("#t-list .del").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Xoá giao dịch này?")) return;
    const id = Number(b.dataset.id);
    try { await mutate("data: delete transaction", (d) => store.deleteTx(d, id)); }
    catch (e) { alert("Lỗi: " + e.message); }
    if (editingId === id) cancelEdit();
    listTx(code);
  }));
}

async function addTx() {
  const body = {
    fundCode: document.getElementById("t-fund").value,
    type: document.getElementById("t-type").value,
    tradeDate: document.getElementById("t-date").value,
    nav: parseNum(document.getElementById("t-nav").value),
    amount: document.getElementById("t-amount").value ? parseNum(document.getElementById("t-amount").value) : undefined,
    units: document.getElementById("t-units").value ? parseNum(document.getElementById("t-units").value) : undefined,
    fee: editingId != null ? editingFee : undefined,
  };
  try {
    if (editingId != null) await mutate("data: update transaction", (d) => store.updateTx(d, editingId, body));
    else await mutate("data: add transaction", (d) => store.addTx(d, body));
    cancelEdit();
    document.getElementById("t-filter").value = body.fundCode; listTx(body.fundCode);
  } catch (e) { alert("Lỗi: " + e.message); }
}

// ---------- sell calculator ----------
function renderSell() {
  const funds = state.summary.funds;
  app.innerHTML = `
    <div class="panel">
      <h3>Ước tính thu nhập khi bán</h3>
      <div class="row">
        <label class="field">Quỹ<select id="s-fund">${funds.map((f) => `<option value="${f.code}">${f.code} (${num(f.units)} CCQ)</option>`).join("")}</select></label>
        <label class="field">Số CCQ bán<input type="text" inputmode="decimal" class="fmt" id="s-units"></label>
        <label class="field">hoặc % danh mục<input type="text" inputmode="decimal" class="fmt" id="s-pct" placeholder="vd 50"></label>
        <label class="field">NAV hiện tại<input type="text" inputmode="decimal" class="fmt" id="s-nav" placeholder="mặc định NAV mới nhất"></label>
        <button id="s-calc">Tính</button>
      </div>
      <div class="muted">Bán theo phương pháp <b>FIFO</b> (lô mua sớm nhất trước); phí tính theo thời gian nắm giữ từng lô.</div>
      <div id="s-result"></div>
    </div>`;
  document.getElementById("s-calc").addEventListener("click", calcSell);
}

async function calcSell() {
  const body = {
    fundCode: document.getElementById("s-fund").value,
    sellUnits: document.getElementById("s-units").value ? parseNum(document.getElementById("s-units").value) : undefined,
    sellPct: document.getElementById("s-pct").value ? parseNum(document.getElementById("s-pct").value) : undefined,
    currentNav: document.getElementById("s-nav").value ? parseNum(document.getElementById("s-nav").value) : undefined,
  };
  try {
    const lots = store.buyLots(db, body.fundCode);
    const nav = body.currentNav || store.latestNav(db, body.fundCode) || 0;
    const sellUnits = body.sellPct != null ? holding(lots).units * (body.sellPct / 100) : Number(body.sellUnits);
    const r = estimateSell(lots, sellUnits, nav, store.feeTiers(db, body.fundCode), new Date().toISOString().slice(0, 10));
    document.getElementById("s-result").innerHTML = `
      <div class="result">
        Bán <b>${num(r.sellUnits)}</b> CCQ @ NAV ${vnd(r.currentNav)}<br>
        Tổng thu (gộp): <b>${vnd(r.grossProceeds)}</b> &nbsp;·&nbsp; Phí bán: <span class="down">${vnd(r.totalFee)}</span><br>
        Thực nhận: <b>${vnd(r.netProceeds)}</b> &nbsp;·&nbsp; Giá vốn: ${vnd(r.costBasis)}<br>
        Lãi/Lỗ ước tính: <b class="${cls(r.profit)}">${vnd(r.profit)} (${pct(r.profitPct)})</b>
      </div>
      <table style="margin-top:12px"><thead><tr><th>Lô mua</th><th>CCQ bán</th><th>Ngày giữ</th><th>Phí</th><th>Thu gộp</th><th>Thực nhận</th><th>Lãi/Lỗ</th></tr></thead><tbody>
      ${r.perLot.map((p) => `<tr><td>${p.tradeDate}</td><td>${num(p.unitsSold)}</td><td>${p.holdingDays}</td>
        <td>${num(p.feeRate * 100, 2)}%</td><td>${vnd(p.gross)}</td><td>${vnd(p.net)}</td>
        <td class="${cls(p.profit)}">${vnd(p.profit)}</td></tr>`).join("")}
      </tbody></table>`;
  } catch (e) { document.getElementById("s-result").innerHTML = `<div class="result down">${e.message}</div>`; }
}

// ---------- buy calculator ----------
function renderBuy() {
  const funds = state.summary.funds;
  app.innerHTML = `
    <div class="panel">
      <h3>Tính giá vốn trung bình trước khi mua</h3>
      <div class="row">
        <label class="field">Quỹ<select id="b-fund">${funds.map((f) => `<option value="${f.code}">${f.code}</option>`).join("")}</select></label>
        <label class="field">Số tiền dự định mua<input type="text" inputmode="decimal" class="fmt" id="b-amount" placeholder="vd 5.000.000"></label>
        <label class="field">NAV dự kiến<input type="text" inputmode="decimal" class="fmt" id="b-nav" placeholder="mặc định NAV mới nhất"></label>
        <button id="b-calc">Tính</button>
      </div>
      <div id="b-result"></div>
    </div>`;
  document.getElementById("b-calc").addEventListener("click", calcBuy);
}

async function calcBuy() {
  const body = {
    fundCode: document.getElementById("b-fund").value,
    amount: parseNum(document.getElementById("b-amount").value),
    nav: document.getElementById("b-nav").value ? parseNum(document.getElementById("b-nav").value) : undefined,
  };
  try {
    const h = holding(store.buyLots(db, body.fundCode));
    const r = avgCostAfterBuy(h.units, h.avgCost, body.amount, body.nav || store.latestNav(db, body.fundCode) || 0);
    const arrow = r.avgDelta <= 0 ? "giảm" : "tăng";
    document.getElementById("b-result").innerHTML = `
      <div class="result">
        Mua thêm <b>${num(r.buyUnits)}</b> CCQ<br>
        Giá vốn TB trước: <b>${vnd(r.before.avgCost)}</b> (${num(r.before.units)} CCQ)<br>
        Giá vốn TB sau: <b>${vnd(r.after.avgCost)}</b> (${num(r.after.units)} CCQ)<br>
        Thay đổi giá vốn: <b class="${cls(-r.avgDelta)}">${vnd(r.avgDelta)} (${arrow})</b>
      </div>`;
  } catch (e) { document.getElementById("b-result").innerHTML = `<div class="result down">${e.message}</div>`; }
}

// ---------- fees ----------
async function renderFees() {
  const funds = state.summary.funds;
  app.innerHTML = `
    <div class="panel">
      <h3>Biểu phí bán <select id="f-fund">${funds.map((f) => `<option>${f.code}</option>`).join("")}</select></h3>
      <div class="muted">Bậc theo số ngày nắm giữ. maxDays trống = vô hạn. Rate 0.01 = 1%. <b>Kiểm tra với điều khoản thực tế của quỹ.</b></div>
      <div id="f-body"></div>
    </div>`;
  const sel = document.getElementById("f-fund");
  sel.addEventListener("change", () => loadFees(sel.value));
  loadFees(funds[0].code);
}

function loadFees(code) {
  const tiers = store.feeTiers(db, code);
  const body = document.getElementById("f-body");
  body.innerHTML = `
    <table style="margin:10px 0"><thead><tr><th>Từ ngày</th><th>Đến ngày (&lt;)</th><th>Phí %</th><th></th></tr></thead>
    <tbody id="f-rows"></tbody></table>
    <button class="ghost" id="f-addrow">+ Thêm bậc</button>
    <button id="f-save">Lưu</button>`;
  const rows = document.getElementById("f-rows");
  const g = (v) => v === "" || v == null ? "" : groupVN(String(v).replace(".", ","));
  const addRow = (t = { minDays: 0, maxDays: "", rate: 0 }) => rows.appendChild(el(
    `<tr><td><input type="text" inputmode="decimal" value="${g(t.minDays)}" class="fmt fd-min" style="min-width:90px"></td>
     <td><input type="text" inputmode="decimal" value="${g(t.maxDays)}" class="fmt fd-max" style="min-width:90px"></td>
     <td><input type="text" inputmode="decimal" value="${g(t.rate)}" class="fmt fd-rate" style="min-width:90px"></td>
     <td><button class="del">Xoá</button></td></tr>`));
  tiers.forEach(addRow);
  document.getElementById("f-addrow").addEventListener("click", () => addRow());
  rows.addEventListener("click", (e) => { if (e.target.classList.contains("del")) e.target.closest("tr").remove(); });
  document.getElementById("f-save").addEventListener("click", async () => {
    const out = [...rows.querySelectorAll("tr")].map((tr) => ({
      minDays: parseNum(tr.querySelector(".fd-min").value),
      maxDays: tr.querySelector(".fd-max").value === "" ? null : parseNum(tr.querySelector(".fd-max").value),
      rate: parseNum(tr.querySelector(".fd-rate").value),
    }));
    try {
      await mutate("data: update fees", (d) => store.setFees(d, code, out));
      alert("Đã lưu biểu phí " + code);
    } catch (e) { alert("Lỗi: " + e.message); }
  });
}

// ---------- boot ----------
(async () => {
  document.getElementById("asof").textContent = "Cập nhật: " + new Date().toLocaleDateString("vi-VN");
  await render();
})();
