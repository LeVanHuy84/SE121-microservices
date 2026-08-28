import json
import re
from pathlib import Path
from typing import Optional
from datasets import load_dataset

# Clean Target Mapping (Strictly controlled to eliminate label noise)
# 1: Sadness, 2: Disgust, 3: Anger, 4: Fear, 5: Surprise
TARGET_MAP = {
    "anger": 3,         # Pure Anger
    "annoyance": 3,     # Anger/Annoyance
    "sadness": 1,       # Pure Sadness
    "grief": 1,         # Sadness/Grief
    "remorse": 1,       # Sadness/Regret
    "disgust": 2,       # Disgust
    "fear": 4,          # Fear
    "nervousness": 4,   # Fear
    "surprise": 5,      # Surprise
}

ALL_GOEMOTIONS = [
    "admiration", "amusement", "anger", "annoyance", "approval", "caring", 
    "confusion", "curiosity", "desire", "disappointment", "disapproval", 
    "disgust", "embarrassment", "excitement", "fear", "gratitude", "grief", 
    "joy", "love", "nervousness", "optimism", "pride", "realization", 
    "relief", "remorse", "sadness", "surprise", "neutral"
]

TARGET_AUGMENT_LIMITS = {
    1: 300,  # Sadness (sadness + grief + remorse)
    3: 800,  # Anger (anger + annoyance)
    4: 900,  # Fear (fear + nervousness)
    2: 500,  # Disgust (pure disgust)
    5: 700   # Surprise (pure surprise)
}

LABEL_NAMES = ["Enjoyment", "Sadness", "Disgust", "Anger", "Fear", "Surprise", "Other"]

# Emotion cues used by the context-ambiguity heuristic
EMOTION_CUE_KEYWORDS = {
    "sadness": {"sad", "depressed", "heartbroken", "crying", "cry", "miss", "sorrow", "lonely", "grief", "pain", "hurt", "disappointed", "unhappy", "regret", "apologize", "sorry"},
    "anger": {"angry", "mad", "furious", "hate", "idiot", "stupid", "annoying", "pissed", "shut up", "bullshit", "rage", "scam", "trash", "worst", "damn", "wtf", "hell", "how could", "why the hell", "why would"},
    "fear": {"scared", "afraid", "terrified", "fear", "worried", "panic", "anxious", "creepy", "horrifying", "danger", "warning", "nightmare", "frightened"},
    "disgust": {"gross", "disgusting", "nasty", "revolting", "vile", "sick", "yuck", "eww", "horrible", "repulsive", "trash"},
    "surprise": {"wow", "omg", "shocked", "surprised", "unbelievable", "woah", "amazing", "unexpected", "never thought", "holy", "insane"}
}


class LLMQualityCheckInterface:
    """
    Interface / Pipeline Blueprint for LLM-based standalone emotion quality checking.
    Designed for thesis architecture extensibility (Quality-check filter stage).
    """
    def __init__(self, enabled: bool = False):
        self.enabled = enabled

    def build_verification_prompt(self, text: str, emotion_name: str) -> str:
        return (
            f"Given the standalone text: \"{text}\"\n"
            f"Does this text clearly convey the emotion '{emotion_name}' WITHOUT needing extra context?\n"
            f"Reply with YES or NO."
        )

    def verify_sample(self, text: str, emotion_name: str) -> bool:
        if not self.enabled:
            # Pass-through when LLM checking is disabled during fast extraction
            return True
        # Interface placeholder for API integration if needed in thesis experiments
        return True


def is_reddit_artifact(text: str) -> bool:
    """Check if text contains Reddit artifacts, URLs, or markdown formatting noise."""
    text_lower = text.lower()
    
    # 1. URL and Reddit references
    if any(k in text_lower for k in ["http://", "https://", "r/", "u/", "sub/"]):
        return True
        
    # 2. Deleted / Removed / Quote tokens
    if text.startswith(">") or "[deleted]" in text_lower or "[removed]" in text_lower:
        return True
        
    # 3. Edit tags & Markdown links
    if re.search(r"\bedit:\b|\bedited:\b", text_lower) or re.search(r"\[.*?\]\(.*?\)", text):
        return True
        
    # 4. HTML entities
    if re.search(r"&(?:amp|gt|lt|quot|apos);", text):
        return True

    return False


def is_context_ambiguous(text: str, source_emotion: str) -> bool:
    """
    Detect sentences that depend heavily on conversational context (Reddit thread context)
    and lack standalone emotional clarity.
    """
    text_lower = text.lower().strip()
    words = text_lower.split()

    mapped_target = "sadness" if source_emotion in ["sadness", "grief", "remorse"] else \
                    "anger" if source_emotion in ["anger", "annoyance"] else \
                    "fear" if source_emotion in ["fear", "nervousness"] else \
                    source_emotion
    keywords = EMOTION_CUE_KEYWORDS.get(mapped_target, set())
    has_emotion_signal = any(kw in text_lower for kw in keywords) or "!" in text or "fuck" in text_lower or "shit" in text_lower

    # Rule 1: Generic conversational questions lacking explicit emotional keywords
    # e.g., "What makes you say that?", "Why did you do that?", "Who said that?"
    is_question = text.endswith("?") or words[0] in ["what", "why", "how", "who", "where", "is", "are", "do", "does", "can", "could"]
    if is_question and not has_emotion_signal:
        return True

    # Rule 2: Speculative hedges / meta-dialogue replies without emotion signals
    # e.g., "Just rumors online, it most likely won't happen", "I guess so", "Yes, at home recuperating..."
    if not has_emotion_signal:
        if re.search(r"^(just rumors|it most likely|it seems|it depends|i guess|hard to say|not really|makes sense)\b", text_lower):
            return True
        if re.search(r"^(yes|no|yeah|nope)\b", text_lower):
            return True

    # Rule 3: Contradictory laughter / casual prefixes on negative emotion classes
    # e.g., "Lol. Build your own..." tagged as anger
    if source_emotion in ["anger", "annoyance", "disgust", "fear", "nervousness", "sadness", "grief", "remorse"]:
        if text_lower.startswith(("lol", "lmao", "haha", "rofl")):
            return True

    return False


def extract_minority_goemotions(llm_checker: Optional[LLMQualityCheckInterface] = None):
    if llm_checker is None:
        llm_checker = LLMQualityCheckInterface(enabled=False)

    print("Loading Google GoEmotions dataset (raw version)...")
    ds = load_dataset("google-research-datasets/go_emotions", "raw")
    train_ds = ds["train"]

    print(f"Loaded {len(train_ds)} rows from GoEmotions raw dataset.")

    extracted_samples = []
    counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    filtered_stats = {"length": 0, "artifacts": 0, "multi_label": 0, "ambiguous": 0, "llm_rejected": 0}

    for item in train_ds:
        text = item.get("text", "")
        words = text.split()
        
        # 1. Word length filter (5 to 25 words)
        if not (5 <= len(words) <= 25):
            filtered_stats["length"] += 1
            continue

        # 2. Reddit Artifacts & Noise Filter
        if is_reddit_artifact(text):
            filtered_stats["artifacts"] += 1
            continue

        # 3. Pure Single-Label Check (Must have EXACTLY 1 active emotion in GoEmotions)
        active_emotions = [e for e in ALL_GOEMOTIONS if item.get(e) == 1]
        if len(active_emotions) != 1:
            filtered_stats["multi_label"] += 1
            continue

        source_emo = active_emotions[0]

        # 4. Check if emotion belongs to TARGET_MAP early (Avoid computing ambiguity check on non-target emotions)
        target_vsmec_id = TARGET_MAP.get(source_emo)
        if target_vsmec_id is None:
            continue

        # 5. Check if quota is already reached for this target emotion
        if counts[target_vsmec_id] >= TARGET_AUGMENT_LIMITS[target_vsmec_id]:
            continue

        # 6. Context Ambiguity Heuristic Filter
        if is_context_ambiguous(text, source_emo):
            filtered_stats["ambiguous"] += 1
            continue

        # 7. LLM Quality Verification Interface Hook (Optional)
        label_name = LABEL_NAMES[target_vsmec_id]
        if not llm_checker.verify_sample(text, label_name):
            filtered_stats["llm_rejected"] += 1
            continue

        extracted_samples.append({
            "english_text": text,
            "target_label": target_vsmec_id,
            "label_name": label_name,
            "source_emotion": source_emo
        })
        counts[target_vsmec_id] += 1

    out_dir = Path(__file__).parent.parent / "data"
    out_file = out_dir / "goemotions_minority_extracted.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(extracted_samples, f, ensure_ascii=False, indent=2)


    print("\n" + "=" * 60)
    print("GOEMOTIONS CLEAN & CONTEXT-AWARE EXTRACTION SUCCESSFUL!")
    print(f"Total extracted minority samples: {len(extracted_samples)}")
    print("Filtered breakdown:")
    print(f" - Out of word length range (5-25): {filtered_stats['length']}")
    print(f" - Reddit artifacts & formatting:  {filtered_stats['artifacts']}")
    print(f" - Multi-label / Non-pure samples:  {filtered_stats['multi_label']}")
    print(f" - Context ambiguous samples:       {filtered_stats['ambiguous']}")
    print(f" - LLM quality check rejected:      {filtered_stats['llm_rejected']}")
    print("\nExtracted targets:")
    for k, v in counts.items():
        print(f" - Label {k} ({LABEL_NAMES[k]}): {v} samples (Target limit: {TARGET_AUGMENT_LIMITS[k]})")
    print(f"Saved clean extracted data to: {out_file}")
    print("=" * 60)


if __name__ == "__main__":
    extract_minority_goemotions()

