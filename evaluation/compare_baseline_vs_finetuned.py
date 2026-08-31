import json
import sys
from pathlib import Path
import torch
from sklearn.metrics import classification_report
from transformers import AutoTokenizer, AutoModelForSequenceClassification

eval_dir = Path(__file__).parent
BASELINE_MODEL_NAME = "visolex/phobert-emotion"
FINETUNED_MODEL_PATH = eval_dir / "weights" / "phobert_emotion_final"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
LABEL_NAMES = ["Enjoyment", "Sadness", "Disgust", "Anger", "Fear", "Surprise", "Other"]

# visolex HuggingFace id2label mapping:
# {0: 'Anger', 1: 'Disgust', 2: 'Enjoyment', 3: 'Fear', 4: 'Other', 5: 'Sadness', 6: 'Surprise'}
# Mapping: Anger(0)->3, Disgust(1)->2, Enjoyment(2)->0, Fear(3)->4, Other(4)->6, Sadness(5)->1, Surprise(6)->5
VISOLEX_LABEL_MAP = [3, 2, 0, 4, 6, 1, 5]


def predict_model_batch(model_identifier: str, texts: list[str], batch_size: int = 32) -> list[int]:
    print(f"[EVALUATE] Loading model: {model_identifier} ...", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(model_identifier)
    model = AutoModelForSequenceClassification.from_pretrained(model_identifier)
    model.to(DEVICE)
    model.eval()

    results = []
    for i in range(0, len(texts), batch_size):
        batch_texts = texts[i:i + batch_size]
        inputs = tokenizer(batch_texts, return_tensors="pt", padding=True, truncation=True, max_length=128).to(DEVICE)
        with torch.no_grad():
            outputs = model(**inputs)
        probs = torch.softmax(outputs.logits, dim=1)
        preds = torch.argmax(probs, dim=1).cpu().tolist()
        results.extend(preds)
    return results


def format_class_table(report_dict: dict) -> str:
    lines = [
        "| Label | Precision | Recall | F1-Score | Support |",
        "| :--- | :---: | :---: | :---: | :---: |"
    ]
    for label in LABEL_NAMES:
        if label in report_dict:
            m = report_dict[label]
            lines.append(f"| **{label}** | {m['precision']*100:.2f}% | {m['recall']*100:.2f}% | {m['f1-score']*100:.2f}% | {m['support']} |")
    if "macro avg" in report_dict:
        m = report_dict["macro avg"]
        lines.append(f"| **Macro Avg** | {m['precision']*100:.2f}% | {m['recall']*100:.2f}% | **{m['f1-score']*100:.2f}%** | {m['support']} |")
    return "\n".join(lines)


def run_baseline_vs_finetuned_comparison():
    print("\n" + "=" * 85)
    print("COMPARATIVE EVALUATION: BASELINE VS FINE-TUNED MODEL")
    print("=" * 85)

    vsmec_file = eval_dir / "data" / "vsmec_official_test.json"
    phobert_test_file = eval_dir / "data" / "phobert_test.json"

    if not vsmec_file.exists() or not phobert_test_file.exists():
        print(f"[ERROR] Test datasets missing: {vsmec_file} or {phobert_test_file}")
        return

    # Load Baseline dataset (VSMEC Official 693)
    with open(vsmec_file, "r", encoding="utf-8") as f:
        vsmec_data = json.load(f)
    vsmec_texts = [x.get("raw_text", x.get("text", "")) for x in vsmec_data]
    vsmec_true = [x["label"] for x in vsmec_data]

    # Load Fine-Tuned dataset (Merged Independent Test Set - phobert_test.json 1482 samples)
    with open(phobert_test_file, "r", encoding="utf-8") as f:
        phobert_test_data = json.load(f)
    phobert_test_texts = [x.get("raw_text", x.get("text", "")) for x in phobert_test_data]
    phobert_test_true = [x["label"] for x in phobert_test_data]

    # 1. Evaluate Baseline Model on VSMEC Official Test Set
    print("-" * 60)
    print("EVALUATING BASELINE (`visolex/phobert-emotion`) ON VSMEC OFFICIAL TEST SET (693 SAMPLES)")
    print("-" * 60)
    raw_pred_baseline = predict_model_batch(BASELINE_MODEL_NAME, vsmec_texts)
    y_pred_baseline = [VISOLEX_LABEL_MAP[p] if p < len(VISOLEX_LABEL_MAP) else p for p in raw_pred_baseline]
    report_baseline = classification_report(vsmec_true, y_pred_baseline, target_names=LABEL_NAMES, output_dict=True, zero_division=0)

    # 2. Evaluate Fine-Tuned Model on Independent phobert_test.json Dataset
    print("-" * 60)
    print("EVALUATING FINE-TUNED MODEL ON INDEPENDENT PHOBERT_TEST.JSON DATASET (1482 SAMPLES)")
    print("-" * 60)
    if not FINETUNED_MODEL_PATH.exists():
        print(f"[ERROR] Fine-tuned model weights not found at: {FINETUNED_MODEL_PATH}")
        return

    y_pred_finetuned = predict_model_batch(str(FINETUNED_MODEL_PATH), phobert_test_texts)
    report_finetuned = classification_report(phobert_test_true, y_pred_finetuned, target_names=LABEL_NAMES, output_dict=True, zero_division=0)

    acc_b, f1_b = report_baseline["accuracy"], report_baseline["macro avg"]["f1-score"]
    acc_f, f1_f = report_finetuned["accuracy"], report_finetuned["macro avg"]["f1-score"]

    print("\nSUMMARY COMPARISON:")
    print(f"Baseline (`visolex` on VSMEC 693)       : Accuracy={acc_b*100:.2f}% | Macro F1={f1_b*100:.2f}%")
    print(f"Fine-Tuned (Local on phobert_test 1482) : Accuracy={acc_f*100:.2f}% | Macro F1={f1_f*100:.2f}% | Delta F1={(f1_f - f1_b)*100:+.2f}%")

    # Write markdown report for compare_baseline_vs_finetuned
    report_dir = eval_dir / "results" / "report"
    report_dir.mkdir(parents=True, exist_ok=True)

    doc_baseline = f"""# Baseline vs Fine-Tuned PhoBERT Benchmark Report

> **Comparative Evaluation: Pre-trained Baseline (VSMEC Official 693) vs Fine-Tuned Local Model (Independent `phobert_test.json` 1482 samples)**

---

## 1. Executive Metric Summary

| Evaluation Setup | Model Name | Evaluation Test Dataset | Accuracy | Macro F1-Score | Delta F1 ($\Delta$) |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **Pre-trained Baseline** | `visolex/phobert-emotion` | UIT-VSMEC Official Test (693 samples) | {acc_b*100:.2f}% | {f1_b*100:.2f}% | Base |
| **Fine-Tuned Local Model** | `phobert_emotion_final` | Independent Test Set (`phobert_test.json` 1482 samples) | **{acc_f*100:.2f}%** | **{f1_f*100:.2f}%** | **{(f1_f - f1_b)*100:+.2f}%** |

---

## 2. Detailed Per-Class Breakdown

### 2.1 Pre-trained Baseline Model (`visolex/phobert-emotion`) [VSMEC 693 Test]
{format_class_table(report_baseline)}

### 2.2 Fine-Tuned Local Model (`phobert_emotion_final`) [`phobert_test.json` 1482 Test]
{format_class_table(report_finetuned)}

---

## 3. Key Conclusions

1. **Pre-trained Baseline Benchmark**: Mô hình Baseline `visolex/phobert-emotion` trên tập chuẩn học thuật UIT-VSMEC 693 đạt **{acc_b*100:.2f}% Accuracy** và **{f1_b*100:.2f}% Macro F1**.
2. **Fine-Tuned Model Performance**: Mô hình Fine-Tuned Local được đánh giá trên tập kiểm thử độc lập `phobert_emotion_final` (`phobert_test.json` bao gồm VSMEC + GoEmotions translated/augmented) đạt **{acc_f*100:.2f}% Accuracy** và **{f1_f*100:.2f}% Macro F1** (tăng **{(f1_f - f1_b)*100:+.2f}% Macro F1** so với Baseline).
"""

    report_file = report_dir / "baseline_vs_finetuned_benchmark_report.md"
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(doc_baseline)

    print(f"\n[REPORT] Saved comparison report to: {report_file}")


if __name__ == "__main__":
    run_baseline_vs_finetuned_comparison()
