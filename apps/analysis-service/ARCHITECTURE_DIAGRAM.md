# Analysis Service - Refactored Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           API LAYER (FastAPI)                            │
│  POST /analyze/text | POST /analyze/post | GET /analytics/emotions     │
└──────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATION LAYER                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  AnalysisFlowService                                              │  │
│  │  • analyze_content() - Main orchestrator                          │  │
│  │  • analyze_text_only() - Text-only flow                           │  │
│  │                                                                    │  │
│  │  Flow:                                                             │  │
│  │  1. Text Emotion → 2. Image Emotion → 3. Fusion                  │  │
│  │  4. Risk Scoring                                                   │  │
│  │  5. Text Moderation → 6. Image Moderation → 7. Final Decision    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  HandleEventService                                                │  │
│  │  • handle_created() - New content events                          │  │
│  │  • handle_updated() - Update content events                       │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└──────────┬────────────────────────────────────┬─────────────────────────┘
           │                                     │
           ▼                                     ▼
┌──────────────────────────┐         ┌─────────────────────────────────┐
│   DOMAIN LAYER           │         │      AI LAYER                    │
│   (Pure Business Logic)  │         │      (Model Inference)           │
│                          │         │                                  │
│  ┌────────────────────┐  │         │  ┌─────────────────────────┐    │
│  │ EmotionAnalyzer    │  │         │  │ TEXT EMOTION            │    │
│  │ • fuse_emotions()  │◄─┼─────────┼──┤ PhoBERT Classifier      │    │
│  │ • calculate_       │  │         │  │ Text Preprocessor       │    │
│  │   intensity()      │  │         │  │ Sarcasm Detector        │    │
│  │ • average_scores() │  │         │  └─────────────────────────┘    │
│  └────────────────────┘  │         │                                  │
│                          │         │  ┌─────────────────────────┐    │
│  ┌────────────────────┐  │         │  │ IMAGE EMOTION           │    │
│  │ RiskScorer         │  │         │  │ FER Analyzer            │    │
│  │ • calculate_risk() │◄─┼─────────┼──┤ Face Detection          │    │
│  │ • analyze_history()│  │         │  │ Emotion Aggregation     │    │
│  └────────────────────┘  │         │  └─────────────────────────┘    │
│                          │         │                                  │
│  ┌────────────────────┐  │         │  ┌─────────────────────────┐    │
│  │ ContentModerator   │  │         │  │ TEXT MODERATION         │    │
│  │ • aggregate_text_  │  │         │  │ Keyword-based           │    │
│  │   moderation()     │◄─┼─────────┼──┤ PhoBERT Moderator       │    │
│  │ • aggregate_image_ │  │         │  │ Semantic Analysis       │    │
│  │   moderation()     │  │         │  └─────────────────────────┘    │
│  │ • make_final_      │  │         │                                  │
│  │   decision()       │  │         │  ┌─────────────────────────┐    │
│  └────────────────────┘  │         │  │ IMAGE MODERATION        │    │
│                          │         │  │ NSFW Detector           │    │
└──────────────────────────┘         │  │ Violence Detector       │    │
                                     │  │ Image Aggregation       │    │
                                     │  └─────────────────────────┘    │
                                     │                                  │
                                     │  ┌─────────────────────────┐    │
                                     │  │ ModelLoader             │    │
                                     │  │ Central model mgmt      │    │
                                     │  └─────────────────────────┘    │
                                     └─────────────────────────────────┘
                                                   │
                                                   ▼
                                     ┌─────────────────────────────────┐
                                     │  INFRASTRUCTURE LAYER           │
                                     │  • MongoDB (persistence)        │
                                     │  • Kafka (events)               │
                                     │  • Redis (cache)                │
                                     └─────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════

KEY SEPARATION OF CONCERNS:

┌─────────────────────────┐         ┌─────────────────────────────┐
│  EMOTION ANALYSIS       │         │  CONTENT MODERATION         │
│  (What user feels)      │         │  (What's allowed)           │
├─────────────────────────┤         ├─────────────────────────────┤
│                         │         │                             │
│  TEXT EMOTION           │         │  TEXT MODERATION            │
│  ├─ PhoBERT Emotion    │         │  ├─ Keyword Check          │
│  ├─ Preprocessing       │         │  └─ PhoBERT Moderation     │
│  └─ Sarcasm             │         │                             │
│                         │         │  IMAGE MODERATION           │
│  IMAGE EMOTION          │         │  ├─ NSFW Detection         │
│  ├─ FER (faces)        │         │  └─ Violence Detection      │
│  └─ Emotion Scores      │         │                             │
│                         │         │  AGGREGATION                │
│  FUSION & INTENSITY     │         │  ├─ Text + Image           │
│  ├─ Weighted Combo     │         │  ├─ Severity Calc          │
│  └─ Intensity Level     │         │  └─ Action Decision        │
│                         │         │                             │
│  RISK SCORING           │         │                             │
│  ├─ Emotion-based      │         │                             │
│  ├─ History Pattern    │         │                             │
│  └─ Temporal Pattern   │         │                             │
│                         │         │                             │
└─────────────────────────┘         └─────────────────────────────┘
         │                                       │
         └───────────────┬───────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  FINAL ANALYSIS      │
              │  • Emotion Results   │
              │  • Risk Assessment   │
              │  • Moderation Status │
              │  • Recommendations   │
              │  • Action Required   │
              └──────────────────────┘

═══════════════════════════════════════════════════════════════════════════

DATA FLOW EXAMPLE:

User Post: "Buồn quá, không muốn sống nữa 😭" + [image_url]

1. ORCHESTRATION receives request
   ↓
2. TEXT EMOTION ANALYSIS
   ├─ Preprocessing: "buồn quá không muốn sống nữa [buồn]"
   ├─ PhoBERT: {sadness: 0.85, fear: 0.10, ...}
   └─ Result: sadness (high confidence)
   ↓
3. IMAGE EMOTION ANALYSIS
   ├─ Download image
   ├─ FER: detect faces → analyze expressions
   └─ Result: {sadness: 0.70, neutral: 0.20, ...}
   ↓
4. EMOTION FUSION (Domain)
   ├─ Weighted combination (text + image)
   └─ Final: sadness, intensity: severe
   ↓
5. RISK SCORING (Domain)
   ├─ Emotion: sadness (0.7 risk)
   ├─ Keywords: "không muốn sống" (+0.4)
   ├─ History pattern: check user posts
   └─ Final: CRITICAL (0.85) → alert_support_team
   ↓
6. TEXT MODERATION
   ├─ Keyword: self_harm detected
   ├─ PhoBERT: safe (no toxic language)
   └─ Aggregation: flagged for review (self_harm concern)
   ↓
7. IMAGE MODERATION
   ├─ NSFW: safe (0.05)
   ├─ Violence: safe (0.02)
   └─ Aggregation: safe
   ↓
8. FINAL DECISION (Domain)
   ├─ Text: review (self_harm)
   ├─ Image: allow
   └─ Overall: REVIEW (mental health concern)

FINAL RESPONSE:
{
  "finalEmotion": "sadness",
  "intensity": {"level": "severe", "score": 0.85},
  "psychologicalRisk": {
    "level": "critical",
    "score": 0.85,
    "triggers": ["critical_keywords_2", "repeated_negative_pattern"],
    "recommendations": ["alert_support_team", "show_helpline_resources"]
  },
  "moderation": {
    "is_violation": false,  // No community guideline violation
    "severity": "medium",   // Flagged for mental health concern
    "action": "review",     // Human review recommended
    "safe": true           // Content is safe but concerning
  }
}

═══════════════════════════════════════════════════════════════════════════
```
