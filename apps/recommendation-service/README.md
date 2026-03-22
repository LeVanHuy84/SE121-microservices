# Recommendation Service

`recommendation-service` la microservice Python/FastAPI dung de cham `semantic similarity` cho bai toan goi y ket ban.

Service nay khong con giu business logic ranking tong hop. `social-service` van la noi:

- sinh candidate
- enforce hard constraints
- nhan semantic profile text va cham semantic similarity score
- diversity rerank
- paginate theo snapshot

`recommendation-service` chi lam 3 viec:

- nhan `viewerProfileText`
- nhan `candidateProfileText` cua top K candidate
- tra ve `modelScore` trong khoang `[0, 1]`

## Quyết định kiến trúc

### 1. Chi giu mot vai tro: semantic scorer

Service nay khong con route `/recommend/friends`.

Ly do:

- neu ca Python service va NestJS service cung giu cong thuc ranking rieng, he thong se bi split-brain
- score cuoi cung can duoc tune tai mot cho duy nhat
- bai toan friend recommendation can graph constraints va attribution event o `social-service`

### 2. Dung embedding model da ngon ngu thay vi cross-encoder

Default model:

- `intfloat/multilingual-e5-base`

Ly do:

- phu hop hon voi bai toan so khop profile text viewer-candidate
- ho tro da ngon ngu, phu hop voi profile tieng Viet + tieng Anh
- latency va memory hop ly hon cac model large
- dung truc tiep voi `transformers`, khong can remote code

### 3. Dung asymmetric formatting

Viewer va candidate khong doi xung:

- viewer dong vai tro `query`
- candidate dong vai tro `document`

Vi vay service format input theo huong retrieval:

- viewer: `query: ...`
- candidate: `passage: ...`

Neu sau nay doi sang `multilingual-e5-large-instruct`, query se duoc format thanh:

- `Instruct: ...`
- `Query: ...`

### 4. Khong map cosine similarity bang `(x + 1) / 2`

Embedding cosine thuong nam trong mot dai rat hep. Neu map truc tiep bang `(x + 1) / 2`, score se bi nen va kho phan tach candidate.

Vi vay service dung calibration:

```text
normalized = clamp((cosine - floor) / (ceiling - floor), 0, 1)
```

Mac dinh:

- `RECOMMENDATION_SCORE_FLOOR=0.55`
- `RECOMMENDATION_SCORE_CEILING=0.9`

Day la gia tri khoi dau de quan sat phan bo score trong production va tune tiep.

### 5. Service tu cham diem semantic

`recommendation-service` khong nhan heuristic score de override ket qua model nua.

No chi nhan:

- `viewerProfileText`
- `candidateProfileText`
- social context toi thieu de sinh reason

Va tu sinh `modelScore` tu embedding model.

## API

Tat ca endpoint deu yeu cau header:

- `x-internal-key`

### POST `/recommend/rerank`

Body:

```json
{
  "viewerId": "user-1",
  "viewerProfileText": "name: Linh Nguyen\nbio: mobile engineer, photography, football",
  "candidates": [
    {
      "candidateId": "user-2",
      "mutualFriends": 3,
      "commonGroups": 2,
      "candidateProfileText": "name: Bao Tran\nbio: builds mobile apps and joins football groups"
    }
  ]
}
```

Response:

```json
{
  "success": true,
  "data": {
    "model": {
      "modelName": "intfloat/multilingual-e5-base",
      "device": "cpu",
      "scoreFloor": "0.55",
      "scoreCeiling": "0.9"
    },
    "scores": [
      {
        "candidateId": "user-2",
        "modelScore": 0.71,
        "reason": "Ho so ngu nghia kha phu hop"
      }
    ]
  }
}
```

## Cau hinh

- `INTERNAL_SERVICE_KEY`
- `RECOMMENDATION_MODEL_NAME`
- `RECOMMENDATION_MAX_LENGTH`
- `RECOMMENDATION_BATCH_SIZE`
- `RECOMMENDATION_MAX_CANDIDATES`
- `RECOMMENDATION_QUERY_INSTRUCTION`
- `RECOMMENDATION_SCORE_FLOOR`
- `RECOMMENDATION_SCORE_CEILING`
- `HOST`
- `PORT`
- `RELOAD`

## Ghi chu van hanh

- Warmup model tai startup de giam request lan dau
- Batch score candidate trong mot request de giam chi phi inference
- Service nay phu hop nhat khi `social-service` da cat top K candidate truoc khi goi sang Python
