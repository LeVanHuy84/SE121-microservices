# 📊 PHÂN TÍCH HỆ THỐNG TRENDING - FEED SERVICE

> Phân tích chi tiết luồng hoạt động của Trending System từ Ingestion → Emotion Analysis → Get Trending

---

## 🔄 **TỔNG QUAN LUỒNG DỮ LIỆU**

```
POST_CREATED → Cache lần đầu (Redis + MongoDB)
     ↓
STATS_EVENT → Cập nhật engagement score (reactions, comments, shares)
     ↓
EMOTION_RESULT → Index emotion intensity vào Redis
     ↓
DECAY_CRON → Giảm score theo thời gian (mỗi 10 phút)
     ↓
GET_TRENDING → Fetch → Re-rank → Return
```

---

## 1️⃣ **INGESTION POST - Cache lần đầu**

**File:** `ingestion/service/ingestion-post.service.ts`

### Khi nhận event `POST.CREATED`:

```typescript
// 1. Lưu snapshot vào MongoDB
await this.postModel.create({
  ...payload,
  postCreatedAt: new Date(payload.createdAt),
});

// 2. Khởi tạo metadata trong Redis (Hash)
const metaKey = `post:meta:${postId}`;
await this.redis.hset(metaKey, {
  createdAt: createdAt.getTime(), // Timestamp tạo post
  lastStatAt: createdAt.getTime(), // Lần cuối cập nhật stats
});
await this.redis.expire(metaKey, 30 * 24 * 60 * 60); // TTL: 30 ngày

// 3. Thêm vào ZSET trending với điểm khởi đầu = 8
await this.redis.zadd('post:score', 8, postId);
```

### Vai trò:

- **MongoDB:** Lưu trữ snapshot đầy đủ của post
- **Redis Hash (`post:meta`):** Metadata cho tính toán decay và tracking
- **Redis ZSET (`post:score`):** Ranking board chính, score khởi đầu = 8

---

## 2️⃣ **NHẬN EVENT STATS - Cập nhật Engagement**

**File:** `ingestion/service/ingestion-stats.service.ts`

### Khi nhận event `STATS` (batch):

```typescript
// Công thức tính điểm
const weights = {
  REACTION: 1,   // Like, Love, etc. = +1 điểm
  COMMENT: 3,    // Comment = +3 điểm
  SHARE: 4       // Share = +4 điểm
};

// Tính tổng delta
totalScoreDelta = (reactionDelta × 1) + (commentDelta × 3) + (shareDelta × 4);

// Pipeline Redis update
await redis.zincrby('post:score', totalScoreDelta, postId);
await redis.hset(`post:meta:${postId}`, 'lastStatAt', timestamp);

// Update snapshot trong MongoDB
await this.postModel.updateOne(
  { postId },
  {
    $inc: {
      'stats.reactions': reactionDelta,
      'stats.comments': commentDelta,
      'stats.shares': shareDelta,
      'stats.likes': likeDelta,
      // ... các stats khác
    }
  }
);
```

### Ví dụ:

- Post nhận 5 likes → score +5
- Post nhận 2 comments → score +6
- Post nhận 1 share → score +4
- **Tổng:** score tăng +15 điểm trong `post:score`

---

## 3️⃣ **NHẬN EVENT EMOTION - Index Emotion Intensity**

**File:** `consumer/consumer.service.ts`

### Khi Analysis Service gửi `EMOTION_RESULT.CREATED/UPDATED`:

```typescript
// 1. Lưu emotion feature vào MongoDB
post.emotionFeature = {
  label: 'joy',              // Emotion chính
  confidence: 0.92,          // Độ tin cậy (0-1)
  intensity: 0.85,           // Cường độ cảm xúc (0-1)
  dominantScene: 'outdoor',
  scores: { joy: {...} },
  riskHintLevel: 'low'
};
await post.save();

// 2. Index vào Redis
// a) Remove khỏi emotion cũ (nếu emotion thay đổi)
if (oldLabel && oldLabel !== newLabel) {
  await redis.zrem(`post:emotion:${oldLabel.toLowerCase()}:score`, postId);
}

// b) Update metadata
await redis.hset(`post:meta:${postId}`, {
  emotionLabel: 'joy',
  emotionIntensity: '0.85',
  emotionConfidence: '0.92'
});

// c) Add/update vào emotion-specific ZSET (score = intensity)
await redis.zadd('post:emotion:joy:score', 0.85, postId);
await redis.expire('post:emotion:joy:score', 30 * 24 * 60 * 60);
```

### Kết quả:

- Post được index vào `post:emotion:joy:score` với score = **0.85** (intensity)
- Metadata được cập nhật với thông tin emotion đầy đủ
- Nếu emotion thay đổi (VD: joy → sadness), tự động remove khỏi ZSET cũ

---

## 4️⃣ **DECAY CRON - Giảm Score Theo Thời Gian**

**File:** `feed-pipeline/services/stats.trending.cron.ts`

### Chạy mỗi 10 phút:

```typescript
const DECAY_LAMBDA = 0.15; // Tốc độ giảm

// Formula
decayedScore = oldScore / (1 + λ × daysPassed)

// VD:
// - Post mới (0 ngày): score = 100 / (1 + 0) = 100
// - Sau 1 ngày: score = 100 / (1 + 0.15 × 1) = 86.96 ↓13%
// - Sau 3 ngày: score = 100 / (1 + 0.15 × 3) = 68.97 ↓31%
// - Sau 7 ngày: score = 100 / (1 + 0.15 × 7) = 48.78 ↓51%
```

### Flow:

```typescript
// 1. Lấy tất cả posts trong trending
const postScores = await redis.zrange('post:score', 0, -1, 'WITHSCORES');

// 2. Lấy createdAt từ metadata (batch)
for (const postId of postIds) {
  const createdAt = await redis.hget(`post:meta:${postId}`, 'createdAt');
}

// 3. Tính toán decay và update
for (const postId of postIds) {
  const daysPassed = (now - createdAt) / 86400000;
  const decayedScore = oldScore / (1 + 0.15 * daysPassed);
  await redis.zadd('post:score', decayedScore, postId);
}
```

### Mục đích:

- Đảm bảo post cũ tự động giảm ranking
- Post mới có lợi thế hơn (freshness)
- Tránh post cũ "đóng băng" ở top

---

## 5️⃣ **GET TRENDING - Lấy Danh Sách Trending**

**File:** `feed-pipeline/services/trending.service.ts`

### API Request:

```typescript
{
  cursor?: string,        // Pagination cursor (format: "score_timestamp")
  limit: 10,             // Số lượng posts
  mainEmotion?: 'joy'    // Filter theo emotion (optional)
}
```

### Luồng xử lý:

#### **Bước 1: Xác định Redis Key**

```typescript
if (mainEmotion) {
  // Filter theo emotion → ZINTERSTORE
  effectiveKey = `post:score:tmp:joy`;

  await redis.zinterstore(
    'post:score:tmp:joy',
    2, // Số lượng ZSETs
    'post:score', // ZSET 1: Engagement ranking
    'post:emotion:joy:score', // ZSET 2: Joy intensity
    'WEIGHTS',
    1,
    0.3, // Weights: [1.0, 0.3]
  );

  // Kết quả: score = (engagement × 1.0) + (intensity × 0.3)
  // TTL: 5 giây (temp key)
} else {
  // Không filter → dùng trực tiếp
  effectiveKey = 'post:score';
}
```

**Ý nghĩa của ZINTERSTORE:**

- Kết hợp 2 tiêu chí: Engagement (weight=1.0) + Emotion Intensity (weight=0.3)
- VD: Post A có engagement=100, joy_intensity=0.8
  - Final score = 100×1.0 + 0.8×0.3 = 100.24
- Post có intensity cao hơn được boost thêm điểm

#### **Bước 2: Over-fetch Candidates**

```typescript
const candidateLimit = limit × 3;  // Lấy 30 posts để re-rank → trả về 10

const ids = await redis.zrevrangebyscore(
  effectiveKey,
  maxScore,      // Parse từ cursor (hoặc '+inf' nếu page đầu)
  '-inf',
  'LIMIT', 0, candidateLimit
);
```

**Tại sao over-fetch?**

- Redis ranking chỉ dựa trên engagement + intensity
- Re-ranking strategy phức tạp hơn (4 factors)
- Cần đủ candidates để chọn top items sau re-rank

#### **Bước 3: Load Snapshots từ MongoDB**

```typescript
const postsFromDB = await snapshotRepo.findPostsByIds(ids);

// Preserve order từ Redis
const orderedSnapshots = ids
  .map((id) => snapshotMap.get(id))
  .filter((p) => p != null);
```

#### **Bước 4: Re-rank với Strategy**

```typescript
const candidates: RankingCandidate[] = orderedSnapshots.map((snapshot) => ({
  postId: snapshot.postId,
  snapshot: snapshot,
  baseScore: redisScore, // Score từ Redis
  timestamp: snapshot.postCreatedAt,
}));

// Gọi RankingService
const rankedItems = await rankingService.rankForTrending(
  candidates,
  mainEmotion,
);

// Take top 10
const topItems = rankedItems.slice(0, limit);
```

#### **Bước 5: Lấy Reactions của User (nếu có)**

```typescript
if (userId) {
  reactions = await postClient.send('get_reacted_types_batch', {
    userId,
    targetType: TargetType.POST,
    targetIds: topItems.map((item) => item.postId),
  });
}
```

#### **Bước 6: Map sang DTO & Return**

```typescript
const dtoPosts = SnapshotMapper.toPostSnapshotDTOs(
  topItems.map((item) => item.snapshot),
  reactions,
);

// Tính nextCursor
const hasMore = rankedItems.length > limit;
if (hasMore) {
  const last = topItems[topItems.length - 1];
  nextCursor = `${last.finalScore}_${last.timestamp.getTime()}`;
}

return {
  data: dtoPosts,
  nextCursor,
  hasMore,
};
```

---

## 6️⃣ **RE-RANKING STRATEGY**

**File:** `ranking/strategies/trending-ranking.strategy.ts`

### Formula:

```
finalScore = (engagement^0.4) × (freshness^0.2) × (emotionBoost^0.3) × (quality^0.1)
```

### Chi tiết từng factor:

#### **A. Engagement Score (40%)**

```typescript
engagement = log10(reactions×1 + comments×3 + shares×5 + 1)

// VD:
// - 100 reactions, 20 comments, 5 shares
// - total = 100×1 + 20×3 + 5×5 = 185
// - engagement = log10(186) = 2.27
```

#### **B. Freshness Score (20%)**

```typescript
freshness = 1 / (1 + λ × hours)
// λ = 0.025 → half-life ~28 hours

// VD:
// - Post mới (0h): freshness = 1.0
// - Sau 10h: freshness = 0.8
// - Sau 28h: freshness = 0.5 (giảm 50%)
// - Sau 100h: freshness = 0.29
```

#### **C. Emotion Boost Score (30%)**

```typescript
emotionBoost = intensity × multiplier × confidence

// Multipliers (viral potential):
// - joy: 1.2        (viral cao nhất)
// - surprise: 1.15
// - love: 1.1
// - neutral: 1.0
// - sadness: 0.9
// - anger: 0.85
// - fear: 0.8       (viral thấp nhất)

// VD: Post joy với intensity=0.85, confidence=0.92
// emotionBoost = 0.85 × 1.2 × 0.92 = 0.938
```

#### **D. Quality Score (10%)**

```typescript
quality = confidence×0.6 + hasMedia×0.3 + isSafe×0.1

// VD:
// - confidence = 0.9 → 0.54
// - có media → 0.3
// - risk = 'low' → 0.1
// Total = 0.94
```

### Ví dụ tính toán đầy đủ:

```typescript
// Post A:
// - 200 reactions, 30 comments, 10 shares
// - 5 hours old
// - emotion: joy (intensity=0.8, confidence=0.9)
// - có 3 ảnh, risk=low

engagement = log10(200×1 + 30×3 + 10×5 + 1) = log10(341) = 2.53
freshness = 1 / (1 + 0.025 × 5) = 0.89
emotionBoost = 0.8 × 1.2 × 0.9 = 0.864
quality = 0.9×0.6 + 0.3 + 0.1 = 0.94

finalScore = (2.53^0.4) × (0.89^0.2) × (0.864^0.3) × (0.94^0.1)
          = 1.44 × 0.98 × 0.96 × 0.99
          = 1.34
```

---

## 🔑 **REDIS KEYS - VAI TRÒ CHI TIẾT**

| Key Pattern                  | Type   | Nội dung                                                                     | TTL | Vai trò                                                                                                          |
| ---------------------------- | ------ | ---------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------- |
| `post:score`                 | ZSET   | `{postId: score}`                                                            | 30d | **Ranking board chính**. Score = engagement + decay. Được cập nhật real-time khi có stats và mỗi 10 phút (decay) |
| `post:meta:{postId}`         | Hash   | `{createdAt, lastStatAt, emotionLabel, emotionIntensity, emotionConfidence}` | 30d | **Metadata** cho tính toán decay, tracking stats, và lưu emotion info                                            |
| `post:emotion:joy:score`     | ZSET   | `{postId: intensity}`                                                        | 30d | **Index cho filter emotion**. Score = intensity (0-1). Tạo khi nhận emotion result                               |
| `post:emotion:sadness:score` | ZSET   | `{postId: intensity}`                                                        | 30d | Tương tự cho từng emotion                                                                                        |
| `post:score:tmp:joy`         | ZSET   | Kết quả ZINTERSTORE                                                          | 5s  | **Temp key** cho filter emotion. Combine engagement + intensity                                                  |
| `cache:post:{postId}`        | String | JSON snapshot                                                                | 3m  | **Hot cache** để tránh query MongoDB nhiều lần                                                                   |

### Workflow sử dụng keys:

```
GET /trending?emotion=joy
    ↓
1. ZINTERSTORE post:score:tmp:joy ← post:score + post:emotion:joy:score
2. ZREVRANGEBYSCORE post:score:tmp:joy → Lấy top 30 IDs
3. MGET cache:post:{id1}, cache:post:{id2}, ... → Check cache
4. MongoDB query cho các IDs missing cache
5. Re-rank với strategy
6. Return top 10
```

---

## 💾 **CACHE LAYERS**

### **Layer 1: Redis ZSET (Ranking Index)**

- **Mục đích:** Fast lookup top posts theo score
- **Update:** Real-time (stats event) + Periodic (decay cron)
- **Trade-off:** Chỉ lưu score, không lưu content

### **Layer 2: Redis String (Hot Cache)**

- **Key:** `cache:post:{postId}`
- **TTL:** 3 phút
- **Mục đích:** Cache snapshot JSON để tránh query MongoDB
- **Update:** Khi load từ MongoDB, set cache

### **Layer 3: MongoDB (Source of Truth)**

- **Collection:** `post_snapshots`
- **Mục đích:** Lưu trữ đầy đủ post data
- **Update:** Event-driven (POST events, STATS events, EMOTION events)

### Cache flow khi get trending:

```typescript
1. Query Redis ZSET → IDs: [id1, id2, id3, ...]
2. Try cache: MGET cache:post:id1, cache:post:id2, ...
3. Cache HIT: 70% → Parse JSON
4. Cache MISS: 30% → Query MongoDB
5. Set cache: MSET cache:post:id4, ...
6. Return merged results
```

---

## 🎯 **KẾT LUẬN**

### **Ưu điểm của kiến trúc:**

1. **Scalability:** Redis ZSET cho phép lấy top N rất nhanh (O(log N))
2. **Real-time:** Stats update ngay lập tức vào ranking
3. **Emotion-aware:** Filter và boost theo emotion với ZINTERSTORE
4. **Quality ranking:** Re-rank với 4 factors (không chỉ engagement)
5. **Decay mechanism:** Post cũ tự động giảm ranking
6. **Cache layers:** Giảm load MongoDB đáng kể

### **Điểm cần lưu ý:**

1. **Over-fetch:** Cần lấy 3× candidates để re-rank đủ chất lượng
2. **ZINTERSTORE cost:** Mỗi query emotion filter phải tạo temp key
3. **Decay cron:** Chạy mỗi 10 phút cho toàn bộ posts → CPU spike
4. **Cache invalidation:** 3 phút TTL có thể outdated nếu post update nhanh
5. **MongoDB dependency:** Vẫn cần query DB cho candidates không có trong cache

### **Metrics nên theo dõi:**

- Cache hit rate (target: >70%)
- Avg response time (target: <100ms)
- ZSET size (số lượng posts trong trending)
- Decay cron execution time
- MongoDB query latency

---

**Tài liệu tạo:** 04/03/2026  
**Version:** 1.0  
**Author:** System Analysis
