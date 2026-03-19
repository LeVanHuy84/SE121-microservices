# Recommendation Service

`recommendation-service` la microservice Python/FastAPI de phuc vu bai toan goi y ket ban.

Service nay di theo cung pattern voi `analysis-service`: Python de chay model `transformers`, FastAPI de mo HTTP API noi bo, va `social-service` van giu candidate generation + business constraints.

## Muc tieu

- Tra ve danh sach goi y ban be co giai thich ngan gon, deterministic khi input giong nhau
- Tuan thu cac rule nghiep vu co ban:
  - uu tien nhieu ban chung
  - uu tien tuong tac gan day
  - uu tien profile tuong dong
  - khong de xuat nguoi da la ban
  - khong de xuat nguoi bi block hoac report
- Ho tro hai cach dung:
  - `POST /recommend/friends`: tra ve danh sach goi y day du theo cong thuc scoring
  - `POST /recommend/rerank`: route tuong thich voi `social-service`, chi tra `modelScore` de backend NestJS tron vao ranking hien tai

## Cau truc FastAPI

Neu chua biet Python/FastAPI, co the hinh dung nhu sau:

- `app/main.py`
  - diem vao cua ung dung
  - tao `FastAPI(...)`
  - gan router API
  - chay `uvicorn`
- `app/api/recommend_api.py`
  - dinh nghia HTTP routes
  - hien tai co `/recommend/rerank` va `/recommend/friends`
- `app/models/rerank_request.py`
  - schema request/response bang Pydantic
  - tuong duong DTO trong NestJS
- `app/services/rerank_service.py`
  - business logic chinh
  - filter candidate, tinh diem, sap xep, tao reason
- `app/services/model_loader.py`
  - load tokenizer/model `transformers`
  - warmup
  - infer similarity score
- `app/core/config.py`
  - doc bien moi truong
- `app/core/security.py`
  - verify `x-internal-key`
- `app/core/lifespan.py`
  - startup/shutdown hook
  - warmup model luc service khoi dong

## Cong thuc scoring

Service nay dung cong thuc:

```text
score =
  0.5 * mutual_friend_score +
  0.3 * interaction_score +
  0.2 * similarity_score
```

Trong do:

- `mutual_friend_score = so_ban_chung / max_so_ban_chung_trong_tap_candidate_hop_le`
- `interaction_score` nam trong khoang `0 -> 1`
- `similarity_score` nam trong khoang `0 -> 1`

Tat ca score deu duoc clamp vao `[0, 1]`.

Neu `similarityScore` da duoc truyen vao request, service dung gia tri do.

Neu `similarityScore` chua co, service se goi model fine-tuned qua `transformers` de uoc luong similarity score. Nghia la model duoc dung nhu mot signal bo sung, nhung score cuoi van duoc tinh bang cong thuc co dinh de de giai thich va deterministic.

## Tai sao khong de AI ranking toan bo?

Day la quyet dinh kien truc co chu dich:

- `social-service` dang giu cac hard constraints nhu:
  - da la ban
  - da block hai chieu
  - da report
  - da dismiss
- Candidate generation tu social graph va common groups la phan nghiep vu can on dinh, de debug
- AI phu hop hon voi vai tro `similarity scorer` hoac `reranker`
- Neu model/service loi, he thong van fallback duoc

Noi ngan gon:

- `social-service` chon ai duoc phep vao candidate pool
- `recommendation-service` cham diem similarity va ho tro sap xep tot hon

Neu day toan bo ranking sang AI qua som, he thong se:

- kho debug hon
- kho explain hon
- de vi pham hard constraints hon
- phu thuoc nang vao model va latency inference

## API

Tat ca endpoint deu yeu cau header:

- `x-internal-key`

### POST `/recommend/friends`

Dung khi can ket qua dung theo dac ta recommendation agent.

Body:

```json
{
  "viewerId": "user-1",
  "candidates": [
    {
      "candidateId": "user-2",
      "mutualFriends": 5,
      "interactionScore": 0.8,
      "similarityScore": 0.7,
      "sharedInterestCount": 2,
      "alreadyFriend": false,
      "isBlocked": false,
      "isReported": false
    },
    {
      "candidateId": "user-3",
      "mutualFriends": 2,
      "interactionScore": 0.4,
      "similarityScore": 0.9,
      "sharedInterestCount": 3,
      "alreadyFriend": false,
      "isBlocked": false,
      "isReported": false
    }
  ]
}
```

Response:

```json
[
  {
    "user_id": "user-2",
    "score": 0.79,
    "reason": "Co 5 ban chung va co tuong tac gan day"
  },
  {
    "user_id": "user-3",
    "score": 0.53,
    "reason": "Co 2 ban chung va co 3 so thich tuong dong"
  }
]
```

Quy tac:

- chi tra toi da 10 item
- sap xep giam dan theo `score`
- neu bang diem:
  - uu tien nhieu `mutualFriends` hon
  - neu van bang nhau, sap xep tang dan theo `candidateId`

### POST `/recommend/rerank`

Route nay duoc giu lai de tuong thich voi `social-service`.

Nghia vu cua route nay:

- nhan candidate features tu NestJS
- tra `modelScore` trong khoang `0 -> 1`
- `modelScore` nay la `similarity score` da duoc model uoc luong hoac lay tu request
- `social-service` se tu tron `modelScore` vao ranking hien tai

Body:

```json
{
  "viewerId": "user-1",
  "candidates": [
    {
      "candidateId": "user-2",
      "mutualFriends": 3,
      "commonGroups": 2,
      "baseScore": 42,
      "reasons": ["3 mutual friends", "2 common groups"]
    }
  ]
}
```

Response:

```json
{
  "success": true,
  "data": {
    "scores": [
      {
        "candidateId": "user-2",
        "modelScore": 0.71,
        "reason": "Co 3 ban chung"
      }
    ]
  }
}
```

## Tinh deterministic

Service duoc thiet ke de deterministic voi cung input:

- filter theo boolean flags ro rang
- tinh diem bang cong thuc co dinh
- clamp va round score
- sort tie-break theo `mutualFriends`, sau do theo `candidateId`

Neu `similarityScore` duoc truyen san trong request thi ket qua se hoan toan xac dinh theo input.

Neu can dung model fine-tuned de uoc luong `similarityScore`, can dam bao:

- model inference chay o che do `eval()`
- khong co sampling
- cung checkpoint va cung input text

## Cau hinh

- `INTERNAL_SERVICE_KEY`
  - shared secret giua `social-service` va `recommendation-service`
- `RECOMMENDATION_MODEL_NAME`
  - Hugging Face model id hoac local path toi checkpoint fine-tuned
- `RECOMMENDATION_MAX_LENGTH`
  - max token length cho tokenizer
- `RECOMMENDATION_BATCH_SIZE`
  - batch size khi infer
- `HOST`
- `PORT`

## Ghi chu tich hop

Neu muon dung dung model da fine-tune:

1. dat checkpoint vao local path hoac Hugging Face repo
2. tro `RECOMMENDATION_MODEL_NAME` toi checkpoint do
3. giu `social-service` o vai tro candidate generator
4. dung `recommendation-service` de cham `similarityScore` va ho tro rerank

Huong nay an toan hon viec dua toan bo recommendation sang AI ngay tu dau.
