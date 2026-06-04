# Seed Data - Clerk Users Guide

Tất cả scripts liên quan đến Clerk đều nằm trong `seed-data/clerk/`.
Chạy tất cả lệnh từ **root monorepo** (`E:/SE121-microservices`).

## Cấu trúc

```
seed-data/
├── clerk/
│   ├── .env                    # CLERK_SECRET_KEY, CLERK_API_BASE
│   ├── demo-clerk-users.csv    # Danh sách 100 demo users (email, password, ...)
│   ├── create-clerk-users.js   # Tạo users trên Clerk → ghi data/generated-users.json
│   ├── update-profiles.js      # Sync user vào app DB + PATCH profile rich
│   ├── simulate-social.js      # Mô phỏng friend requests, block, recommend
│   └── lib/
│       └── clerk-session-pool.js
├── data/
│   └── generated-users.json    # ← OUTPUT của create-clerk-users.js (source-of-truth)
└── seeds/                      # TypeScript seed scripts (đọc generated-users.json)
```

## Thứ tự chạy đề xuất

```
# 1. Tạo users trên Clerk → ghi generated-users.json
node seed-data/clerk/create-clerk-users.js --limit=50

# 2. Sync profile vào app DB (cần services đang chạy)
node seed-data/clerk/update-profiles.js --limit=50 --seed=123

# 3. Mô phỏng social activity (cần services đang chạy)
node seed-data/clerk/simulate-social.js --limit=50 --rounds=2 --seed=123
```

> Sau bước 1, `seed-data/data/generated-users.json` sẽ có Clerk IDs thực.
> Các seed scripts trong `seeds/` sẽ tự đọc file này.

---

## 1) Tạo user Clerk từ CSV

```bash
node seed-data/clerk/create-clerk-users.js [options] [csv-path]
```

### Options

| Flag | Mô tả |
|------|-------|
| `--limit=N` | Số lượng user lấy từ CSV (default: 70) |
| `--reset` | Xóa user cũ theo email trước khi tạo lại |
| `--reset-only` | Chỉ xóa, không tạo mới |
| `--reset-all` | Xóa toàn bộ email trong CSV (bỏ qua limit) |

### Ví dụ

```bash
# Tạo 50 users, ghi generated-users.json
node seed-data/clerk/create-clerk-users.js --limit=50

# Xóa rồi tạo lại (IDs mới → generated-users.json sẽ được cập nhật)
node seed-data/clerk/create-clerk-users.js --limit=50 --reset

# Chỉ xóa
node seed-data/clerk/create-clerk-users.js --reset-only

# Xóa toàn bộ
node seed-data/clerk/create-clerk-users.js --reset-all
```

---

## 2) Sync profile rich vào app DB

```bash
node seed-data/clerk/update-profiles.js [options] [csv-path]
```

### Options

| Flag | Mô tả |
|------|-------|
| `--limit=N` | Số lượng user xử lý (default: 70) |
| `--seed=S` | Seed random để tạo profile ổn định |

```bash
node seed-data/clerk/update-profiles.js --limit=50 --seed=123
```

---

## 3) Mô phỏng social activity

```bash
node seed-data/clerk/simulate-social.js [options] [csv-path]
```

### Options

| Flag | Mô tả |
|------|-------|
| `--limit=N` | Số lượng user (default: 70) |
| `--rounds=N` | Số vòng mô phỏng (default: 2) |
| `--seed=S` | Seed random |
| `--api-base=URL` | API Gateway URL |
| `--dry-run` | Không gọi API thật |

```bash
node seed-data/clerk/simulate-social.js --limit=50 --rounds=2 --seed=123
```

---

## 4) Dry Run

### Bash / Git Bash

```bash
DRY_RUN=1 node seed-data/clerk/create-clerk-users.js --limit=10
DRY_RUN=1 node seed-data/clerk/update-profiles.js --limit=10 --seed=1
node seed-data/clerk/simulate-social.js --limit=10 --rounds=1 --seed=1 --dry-run
```

### PowerShell

```powershell
$env:DRY_RUN="1"; node seed-data/clerk/create-clerk-users.js --limit=10
$env:DRY_RUN="1"; node seed-data/clerk/update-profiles.js --limit=10 --seed=1
node seed-data/clerk/simulate-social.js --limit=10 --rounds=1 --seed=1 --dry-run
Remove-Item Env:DRY_RUN
```

---

## 5) Biến môi trường (`seed-data/clerk/.env`)

| Var | Bắt buộc | Mô tả |
|-----|----------|-------|
| `CLERK_SECRET_KEY` | ✅ | Secret key từ Clerk Dashboard |
| `CLERK_PUBLISHABLE_KEY` | — | Dùng khi tạo Clerk client |
| `CLERK_API_BASE` | — | Default: `https://api.clerk.com/v1` |
| `API_BASE_URL` | — | Default: `http://localhost:4000/api/v1` |
| `MAX_USERS` | — | Default cho `--limit` |
| `SOCIAL_ROUNDS` | — | Default cho `--rounds` |
| `SEED` | — | Default cho `--seed` |
| `DRY_RUN` | — | `1` để không gọi API thật |

> ⚠️ Không commit `.env` chứa key thật vào git.
