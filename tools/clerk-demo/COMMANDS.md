# Clerk Demo Tools - Command Guide

File này tổng hợp các lệnh dùng cho bộ tool trong thư mục `tools/clerk-demo`.

## 1) Chuẩn bị

- Mở terminal tại thư mục gốc dự án: `E:/SE121-microservices`
- Cài dependencies (nếu chưa có):

```bash
npm install
```

- Khởi động service cần thiết (gateway + social + user + recommendation):

```bash
npm run recommend:dev:gateway
```

Ghi chú:
- Mặc định API base là `http://localhost:4000/api/v1`
- Các script đọc biến môi trường từ file: `tools/clerk-demo/.env`

## 2) Tạo user Clerk từ CSV

Script: `tools/clerk-demo/create-clerk-users.js`

### Lệnh cơ bản

```bash
node tools/clerk-demo/create-clerk-users.js
```

### Option

- `--limit=70`: số lượng user lấy từ CSV
- `--reset`: xóa user cũ theo email trước khi tạo lại
- `--reset-only`: chỉ xóa, không tạo mới
- `--reset-all`: xóa toàn bộ email có trong CSV (bỏ qua limit)
- Có thể truyền CSV path ở cuối lệnh

### Ví dụ

```bash
node tools/clerk-demo/create-clerk-users.js --limit=50
node tools/clerk-demo/create-clerk-users.js --limit=50 --reset
node tools/clerk-demo/create-clerk-users.js --reset-only
node tools/clerk-demo/create-clerk-users.js --reset-all
node tools/clerk-demo/create-clerk-users.js tools/clerk-demo/demo-clerk-users.csv --limit=30
```

## 3) Cập nhật profile rich + test recommendation data

Script: `tools/clerk-demo/update-profiles-and-test-recommendations.js`

### Lệnh cơ bản

```bash
node tools/clerk-demo/update-profiles-and-test-recommendations.js
```

### Option

- `--limit=70`: số lượng user lấy từ CSV
- `--seed=123`: random seed để tạo dữ liệu profile ổn định
- Có thể truyền CSV path ở cuối lệnh

### Ví dụ

```bash
node tools/clerk-demo/update-profiles-and-test-recommendations.js --limit=70 --seed=123
node tools/clerk-demo/update-profiles-and-test-recommendations.js tools/clerk-demo/demo-clerk-users.csv --limit=30 --seed=2026
```

## 4) Mô phỏng hoạt động social

Script: `tools/clerk-demo/simulate-social-activities.js`

### Lệnh cơ bản

```bash
node tools/clerk-demo/simulate-social-activities.js
```

### Option

- `--limit=70`: số lượng user lấy từ CSV
- `--rounds=2`: số vòng mô phỏng
- `--seed=123`: random seed để tái lập kết quả
- Có thể truyền CSV path ở cuối lệnh

### Ví dụ

```bash
node tools/clerk-demo/simulate-social-activities.js --limit=70 --rounds=2 --seed=123
node tools/clerk-demo/simulate-social-activities.js tools/clerk-demo/demo-clerk-users.csv --limit=40 --rounds=3 --seed=2026
```

## 5) Chạy thử không ghi dữ liệu (Dry Run)

Các script hỗ trợ `DRY_RUN=1`.

### Bash (Git Bash, WSL, Linux, macOS)

```bash
DRY_RUN=1 node tools/clerk-demo/create-clerk-users.js --limit=10
DRY_RUN=1 node tools/clerk-demo/update-profiles-and-test-recommendations.js --limit=10 --seed=1
DRY_RUN=1 node tools/clerk-demo/simulate-social-activities.js --limit=10 --rounds=1 --seed=1
```

### PowerShell

```powershell
$env:DRY_RUN="1"; node tools/clerk-demo/create-clerk-users.js --limit=10
$env:DRY_RUN="1"; node tools/clerk-demo/update-profiles-and-test-recommendations.js --limit=10 --seed=1
$env:DRY_RUN="1"; node tools/clerk-demo/simulate-social-activities.js --limit=10 --rounds=1 --seed=1
Remove-Item Env:DRY_RUN
```

## 6) Biến môi trường thường dùng

- `CLERK_SECRET_KEY`: bắt buộc để gọi Clerk API
- `CLERK_PUBLISHABLE_KEY`: dùng khi tạo Clerk client (nếu có)
- `CLERK_API_BASE`: mặc định `https://api.clerk.com/v1`
- `API_BASE_URL`: mặc định `http://localhost:4000/api/v1`
- `MAX_USERS`: default cho limit
- `SOCIAL_ROUNDS`: default cho rounds (simulate script)
- `SEED`: default cho seed

Khuyến nghị:
- Không commit file `.env` chứa khóa thật vào git.
- Nếu khóa đã lộ, cần rotate key trên Clerk dashboard.

## 7) Thứ tự chạy đề xuất

1. Khởi động service: `npm run recommend:dev:gateway`
2. Tạo user trên Clerk (nếu chưa có): `create-clerk-users.js`
3. Cập nhật profile rich: `update-profiles-and-test-recommendations.js`
4. Mô phỏng social activity: `simulate-social-activities.js`

Lệnh nhanh full flow:

```bash
npm run recommend:dev:gateway
node tools/clerk-demo/create-clerk-users.js --limit=70
node tools/clerk-demo/update-profiles-and-test-recommendations.js --limit=70 --seed=123
node tools/clerk-demo/simulate-social-activities.js --limit=70 --rounds=2 --seed=123
```
