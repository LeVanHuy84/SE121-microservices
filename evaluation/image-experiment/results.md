# (.venv) PS D:\VsCode\NestJS\projects\SE121-microservices\evaluation> python .\image-experiment\vlm_groq_pipeline.py

# PIPELINE THỬ NGHIỆM VLM TÍCH HỢP 100% (CẢM XÚC + KIỂM DUYỆT)

[GroqUnifiedVLMAnalyzer] Base URL: https://api.groq.com/openai/v1
[GroqUnifiedVLMAnalyzer] API Key set: Yes
[GroqUnifiedVLMAnalyzer] Các model khả dụng trên API: ['whisper-large-v3', 'canopylabs/orpheus-v1-english', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-safeguard-20b', 'canopylabs/orpheus-arabic-saudi', 'groq/compound', 'whisper-large-v3-turbo', 'qwen/qwen3.6-27b', 'meta-llama/llama-prompt-guard-2-22m', 'allam-2-7b', 'meta-llama/llama-prompt-guard-2-86m', 'openai/gpt-oss-120b', 'groq/compound-mini']
[GroqUnifiedVLMAnalyzer] Các model Vision tìm thấy: ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-safeguard-20b', 'qwen/qwen3.6-27b', 'openai/gpt-oss-120b']
[GroqUnifiedVLMAnalyzer] => Đã tự động chọn model Vision khả dụng: qwen/qwen3.8-27b

[Test Scenario] Status: "Đường đẹp quá nhỉ =)), đi một lần nhớ mãi!"
[Test Scenario] Images count: 1
[GroqUnifiedVLMAnalyzer] Calling REST endpoint: https://api.groq.com/openai/v1/chat/completions ...

[RESULT UNIFIED JSON OUTPUT]: ??

```json
{
  "modality": "UNIFIED_MULTIMODAL_VLM",
  "primary_emotion": "anger",
  "secondary_emotions": ["disgust"],
  "final_confidence": 0.95,
  "intensity": "moderate",
  "emotion_scores": {
    "joy": 0.05,
    "sadness": 0.05,
    "anger": 0.75,
    "fear": 0.05,
    "disgust": 0.45,
    "surprise": 0.05,
    "neutral": 0.1
  },
  "is_sarcasm_or_conflict": true,
  "conflict_explanation": "Nội dung bài viết khen ngợi đường đẹp và trải nghiệm tốt, nhưng hình ảnh đính kèm lại cho thấy con đường bị hư hỏng nặng, lầy lội và đầy ổ gà. Đây là một sự mâu thuẫn rõ ràng, thể hiện giọng văn mỉa mai (sarcasm) hoặc châm biếm.",
  "content_moderation": {
    "is_flagged": false,
    "flagged_categories": [],
    "confidence": 0.98,
    "reason": "Nội dung chỉ là lời phàn nàn mang tính mỉa mai về cơ sở hạ tầng, không vi phạm các quy tắc an toàn nội dung."
  },
  "mental_health_risk_level": "none",
  "suggested_action": "NO_ACTION_REQUIRED"
}
```
