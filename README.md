# CCQ Tracker

Theo dõi danh mục chứng chỉ quỹ (CCQ): giá vốn trung bình, NAV từ fmarket, ước tính thực nhận khi bán (phí theo thời gian nắm giữ).

Site tĩnh trên **GitHub Pages**, không có server. Toàn bộ dữ liệu nằm trong `public/db.enc.json`, đã mã hoá AES-GCM bằng passphrase. Mỗi lần sửa trên web là một commit vào repo, rồi workflow tự deploy lại sau khoảng 1–2 phút (không realtime).

## Dùng

- Mở site → nhập **passphrase** (lưu trong `sessionStorage` của tab).
- Muốn sửa dữ liệu thì bấm **Token** và dán fine-grained PAT. PAT chỉ cấp cho repo `ccq-tracker`, quyền *Contents* + *Actions* read/write. Token lưu trong `localStorage`; mọi site Pages dưới `namnv2001.github.io` dùng chung localStorage, nên đừng cấp PAT rộng hơn repo này.
- Không có token vẫn xem được, nhưng đọc bản đã deploy và không lưu được thay đổi.
- Nếu một commit khác (ví dụ cron NAV) vừa vào trước, app báo "dữ liệu vừa thay đổi", tự tải lại và sếp thao tác lại.

**Passphrase phải mạnh**: repo public nên mọi phiên bản cũ của file mã hoá đều nằm vĩnh viễn trong git history, và có thể bị brute-force offline.

## NAV từ fmarket

Workflow `.github/workflows/pages.yml` chạy lúc 20:00 giờ VN hằng ngày (và khi bấm nút "Cập nhật NAV"): `npm run refresh-nav` giải mã DB bằng secret `CCQ_PASSPHRASE`, merge NAV mới cùng lịch sử 1 năm, rồi commit và deploy. fmarket lỗi thì vẫn nhập NAV tay được qua tab Giao dịch.

## Thiết lập GitHub

1. Settings → Pages → Source: **GitHub Actions**.
2. Settings → Secrets → Actions: `CCQ_PASSPHRASE`.

## Chạy local

```bash
npm start                                   # http://localhost:3001 (python3 http.server)
npm test                                    # unit test calc/store/crypto
CCQ_PASSPHRASE=... npm run refresh-nav      # cập nhật NAV vào public/db.enc.json
```

## Cấu trúc

```
public/            index.html, app.js, styles.css, vendor/chart.umd.js, db.enc.json
public/lib/        calc (giá vốn/FIFO/định giá), fees, money, store (đọc/sửa DB JSON), crypto
scripts/           refresh-nav.ts, fmarket.ts
test/              unit test
```
