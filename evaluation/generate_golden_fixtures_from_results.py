import json
import os
import sys
from pathlib import Path

# Fix Windows console UTF-8 encoding
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

root_dir = Path(__file__).resolve().parent.parent
results_path = root_dir / "evaluation" / "emotion" / "results" / "phobert_finetune_merged_dataset_full_results.json"
selfharm_path = root_dir / "evaluation" / "moderation" / "data" / "selfharm_vietnamese_augmented.json"
moderation_test_path = root_dir / "evaluation" / "moderation" / "data" / "test.json"
output_path = root_dir / "apps" / "content-feed-service" / "test" / "fixtures" / "golden-recommendation-posts.json"

print(f"Loading full results from {results_path}...")
with open(results_path, "r", encoding="utf-8") as f:
    results_data = json.load(f)
results = results_data["results"]

# Group by prediction primary emotion
by_emotion = {}
for r in results:
    emo = r["prediction"]["primaryEmotion"]
    by_emotion.setdefault(emo, []).append(r)

for emo in by_emotion:
    by_emotion[emo].sort(key=lambda x: x["prediction"]["confidence"], reverse=True)

# Helper to normalize 7 scores so they sum strictly to 1.0
def normalize_scores(raw_scores):
    canonical = ["joy", "sadness", "disgust", "anger", "fear", "surprise", "neutral"]
    scores = {k: round(float(raw_scores.get(k, 0.0)), 4) for k in canonical}
    total = sum(scores.values())
    diff = round(1.0 - total, 4)
    if diff != 0:
        scores["neutral"] = round(scores["neutral"] + diff, 4)
    return scores

posts = []

# 1. JOY: 30 posts (golden-joy-001 to golden-joy-030)
joy_items = by_emotion.get("joy", [])
for i in range(30):
    item = joy_items[i]
    pred = item["prediction"]
    post_id = f"golden-joy-{i+1:03d}"
    scores = normalize_scores(pred["emotionScores"])
    posts.append({
        "postId": post_id,
        "userId": f"author-joy-{(i % 5) + 1}",
        "content": item["input_text"],
        "audience": "PUBLIC",
        "moderationAction": "ALLOW",
        "hasWarning": False,
        "needsMentalSupport": False,
        "postCreatedAt": "2026-10-24T12:00:00.000Z",
        "mediaPreviews": [],
        "stats": {
            "reactions": 100 + (30 - i) * 10,
            "likes": 60 + (30 - i) * 5,
            "loves": 40 + (30 - i) * 5,
            "comments": 20,
            "shares": 5,
        },
        "emotionFeature": {
            "primaryEmotion": "joy",
            "label": "joy",
            "confidence": pred["confidence"],
            "intensity": pred["confidence"],
            "scores": scores,
            "mentalHealthRiskLevel": "none",
            "isSarcasmOrConflict": False,
        },
        "baseTrendingScore": 500 + (30 - i) * 10,
    })

# 2. SADNESS: 30 posts (golden-sad-001 to golden-sad-030)
# Make golden-sad-001 an empathetic post with moderate sadness (around 0.6) for R2.1
sad_items = by_emotion.get("sadness", [])
# Find an item with confidence ~0.60-0.65 for sad-001
empathetic_sad_idx = 0
for idx, it in enumerate(sad_items):
    c = it["prediction"]["confidence"]
    if 0.58 <= c <= 0.68:
        empathetic_sad_idx = idx
        break

used_sad_indices = set()
ordered_sad_items = [sad_items[empathetic_sad_idx]]
used_sad_indices.add(empathetic_sad_idx)
for idx, it in enumerate(sad_items):
    if idx not in used_sad_indices and len(ordered_sad_items) < 30:
        ordered_sad_items.append(it)
        used_sad_indices.add(idx)

for i in range(30):
    item = ordered_sad_items[i]
    pred = item["prediction"]
    post_id = f"golden-sad-{i+1:03d}"
    scores = normalize_scores(pred["emotionScores"])
    posts.append({
        "postId": post_id,
        "userId": f"author-sad-{(i % 5) + 1}",
        "content": item["input_text"],
        "audience": "PUBLIC",
        "moderationAction": "ALLOW",
        "hasWarning": False,
        "needsMentalSupport": False,
        "postCreatedAt": "2026-10-24T12:00:00.000Z",
        "mediaPreviews": [],
        "stats": {
            "reactions": 80 + (30 - i) * 5,
            "likes": 40,
            "loves": 20,
            "comments": 30,
            "shares": 2,
        },
        "emotionFeature": {
            "primaryEmotion": "sadness",
            "label": "sadness",
            "confidence": pred["confidence"],
            "intensity": pred["confidence"],
            "scores": scores,
            "mentalHealthRiskLevel": "none",
            "isSarcasmOrConflict": False,
        },
        "baseTrendingScore": 400 + (30 - i) * 10,
    })

# 3. NEUTRAL / CALM: 20 posts (golden-calm-001 to golden-calm-020)
neutral_items = by_emotion.get("neutral", [])
for i in range(20):
    item = neutral_items[i]
    pred = item["prediction"]
    post_id = f"golden-calm-{i+1:03d}"
    scores = normalize_scores(pred["emotionScores"])
    posts.append({
        "postId": post_id,
        "userId": f"author-calm-{(i % 5) + 1}",
        "content": item["input_text"],
        "audience": "PUBLIC",
        "moderationAction": "ALLOW",
        "hasWarning": False,
        "needsMentalSupport": False,
        "postCreatedAt": "2026-10-24T12:00:00.000Z",
        "mediaPreviews": [],
        "stats": {
            "reactions": 70 + (20 - i) * 5,
            "likes": 50,
            "loves": 20,
            "comments": 15,
            "shares": 3,
        },
        "emotionFeature": {
            "primaryEmotion": "neutral",
            "label": "neutral",
            "confidence": pred["confidence"],
            "intensity": pred["confidence"],
            "scores": scores,
            "mentalHealthRiskLevel": "none",
            "isSarcasmOrConflict": False,
        },
        "baseTrendingScore": 350 + (20 - i) * 10,
    })

# 4. ANGER: 15 posts (golden-rage-001 to golden-rage-015)
anger_items = by_emotion.get("anger", [])
for i in range(15):
    item = anger_items[i]
    pred = item["prediction"]
    post_id = f"golden-rage-{i+1:03d}"
    scores = normalize_scores(pred["emotionScores"])
    posts.append({
        "postId": post_id,
        "userId": f"author-rage-{(i % 5) + 1}",
        "content": item["input_text"],
        "audience": "PUBLIC",
        "moderationAction": "ALLOW",
        "hasWarning": False,
        "needsMentalSupport": False,
        "postCreatedAt": "2026-10-24T12:00:00.000Z",
        "mediaPreviews": [],
        "stats": {
            "reactions": 200 + (15 - i) * 20,
            "likes": 50,
            "loves": 10,
            "comments": 100,
            "shares": 30,
        },
        "emotionFeature": {
            "primaryEmotion": "anger",
            "label": "anger",
            "confidence": pred["confidence"],
            "intensity": pred["confidence"],
            "scores": scores,
            "mentalHealthRiskLevel": "none",
            "isSarcasmOrConflict": True if i == 0 else False,
        },
        "baseTrendingScore": 600 + (15 - i) * 10,
    })

# 5. FEAR: 10 posts (golden-fear-001 to golden-fear-010)
fear_items = by_emotion.get("fear", [])
for i in range(10):
    item = fear_items[i]
    pred = item["prediction"]
    post_id = f"golden-fear-{i+1:03d}"
    scores = normalize_scores(pred["emotionScores"])
    posts.append({
        "postId": post_id,
        "userId": f"author-fear-{(i % 5) + 1}",
        "content": item["input_text"],
        "audience": "PUBLIC",
        "moderationAction": "ALLOW",
        "hasWarning": False,
        "needsMentalSupport": False,
        "postCreatedAt": "2026-10-24T12:00:00.000Z",
        "mediaPreviews": [],
        "stats": {
            "reactions": 150 + (10 - i) * 10,
            "likes": 40,
            "loves": 10,
            "comments": 60,
            "shares": 20,
        },
        "emotionFeature": {
            "primaryEmotion": "fear",
            "label": "fear",
            "confidence": pred["confidence"],
            "intensity": pred["confidence"],
            "scores": scores,
            "mentalHealthRiskLevel": "none",
            "isSarcasmOrConflict": False,
        },
        "baseTrendingScore": 450 + (10 - i) * 10,
    })

# 6. HIGH-RISK SELF-HARM: 5 posts (golden-toxic-high-001 to golden-toxic-high-005)
with open(selfharm_path, "r", encoding="utf-8") as f:
    sh_data = json.load(f)

for i in range(5):
    item = sh_data[i]
    post_id = f"golden-toxic-high-{i+1:03d}"
    posts.append({
        "postId": post_id,
        "userId": f"author-toxic-{i+1}",
        "content": item.get("text", "Tôi không muốn sống nữa"),
        "audience": "PUBLIC",
        "moderationAction": "HARD_BLOCK",
        "hasWarning": True,
        "needsMentalSupport": True,
        "warningReason": "Tự hại hoặc khủng hoảng tâm lý nghiêm trọng",
        "postCreatedAt": "2026-10-24T12:00:00.000Z",
        "mediaPreviews": [],
        "stats": {"reactions": 500, "likes": 100, "loves": 50, "comments": 200, "shares": 50},
        "emotionFeature": {
            "primaryEmotion": "sadness",
            "label": "sadness",
            "confidence": 0.95,
            "intensity": 0.95,
            "scores": {
                "joy": 0.01,
                "sadness": 0.85,
                "disgust": 0.02,
                "anger": 0.05,
                "fear": 0.05,
                "surprise": 0.01,
                "neutral": 0.01,
            },
            "mentalHealthRiskLevel": "HIGH",
            "isSarcasmOrConflict": False,
        },
        "baseTrendingScore": 1000,
    })

# 7. WARNING-FLAGGED: 10 posts (golden-warn-001 to golden-warn-010)
with open(moderation_test_path, "r", encoding="utf-8") as f:
    mod_data = json.load(f)

toxic_mod_items = [x for x in mod_data if x.get("label_name") in ["HATE_SPEECH", "PROFANITY_VENTING"]]
for i in range(10):
    item = toxic_mod_items[i]
    post_id = f"golden-warn-{i+1:03d}"
    posts.append({
        "postId": post_id,
        "userId": f"author-warn-{(i % 5) + 1}",
        "content": item.get("raw_text") or item.get("text", "Nội dung vi phạm"),
        "audience": "PUBLIC",
        "moderationAction": "ALLOW_WITH_WARNING",
        "hasWarning": True,
        "warningReason": "Nội dung có thể gây khó chịu hoặc tranh cãi",
        "needsMentalSupport": False,
        "postCreatedAt": "2026-10-24T12:00:00.000Z",
        "mediaPreviews": [],
        "stats": {"reactions": 300, "likes": 50, "loves": 10, "comments": 120, "shares": 40},
        "emotionFeature": {
            "primaryEmotion": "anger",
            "label": "anger",
            "confidence": 0.88,
            "intensity": 0.88,
            "scores": {
                "joy": 0.02,
                "sadness": 0.05,
                "disgust": 0.20,
                "anger": 0.65,
                "fear": 0.05,
                "surprise": 0.01,
                "neutral": 0.02,
            },
            "mentalHealthRiskLevel": "none",
            "isSarcasmOrConflict": True if i < 4 else False,
        },
        "baseTrendingScore": 700,
    })

print(f"Generated {len(posts)} golden recommendation posts.")

# Save to output file
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(posts, f, ensure_ascii=False, indent=2)

print(f"Successfully saved golden fixtures to {output_path}!")
