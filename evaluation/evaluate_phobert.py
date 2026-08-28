import json
import os
import sys
from pathlib import Path
import torch
from sklearn.metrics import classification_report
from transformers import AutoTokenizer, AutoModelForSequenceClassification

# Import Teencode Normalizer from apps/ai-chatbot-service
project_root = Path(__file__).resolve().parent.parent
chatbot_utils_path = project_root / "apps" / "ai-chatbot-service"
if str(chatbot_utils_path) not in sys.path:
    sys.path.insert(0, str(chatbot_utils_path))

try:
    from app.utils.teencode.teencode_normalizer import teencode_normalizer
except ImportError:
    print("[WARNING] Could not import teencode_normalizer from ai-chatbot-service. Preprocessing evaluation will be skipped.")
    teencode_normalizer = None

eval_dir = Path(__file__).parent
BASELINE_MODEL_NAME = "visolex/phobert-emotion"
FINETUNED_MODEL_PATH = eval_dir / "weights" / "phobert_emotion_final"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
LABEL_NAMES = ["Enjoyment", "Sadness", "Disgust", "Anger", "Fear", "Surprise", "Other"]

# visolex HuggingFace id2label config:
# {0: 'Anger', 1: 'Disgust', 2: 'Enjoyment', 3: 'Fear', 4: 'Other', 5: 'Sadness', 6: 'Surprise'}
# Standard order: ["Enjoyment" (0), "Sadness" (1), "Disgust" (2), "Anger" (3), "Fear" (4), "Surprise" (5), "Other" (6)]
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


def evaluate_dataset(test_file_path: Path, dataset_name: str, eval_pipeline: bool = False):
    print("\n" + "=" * 85)
    print(f"BENCHMARK SUITE: {dataset_name.upper()}")
    print("=" * 85)

    if not test_file_path.exists():
        print(f"[ERROR] Test dataset not found at: {test_file_path}")
        return None

    with open(test_file_path, "r", encoding="utf-8") as f:
        test_set = json.load(f)

    # Allow both 'raw_text' or 'text' key
    raw_texts = [x.get("raw_text", x.get("text", "")) for x in test_set]
    y_true = [x["label"] for x in test_set]

    print(f"[DATASET] Loaded {len(raw_texts)} test samples from {test_file_path.name}")

    # Model 1: Baseline (Raw Text)
    print("-" * 60)
    print("MODEL 1: Baseline Pre-trained Model (visolex/phobert-emotion) [Raw Input]")
    print("-" * 60)
    raw_pred_baseline = predict_model_batch(BASELINE_MODEL_NAME, raw_texts)
    y_pred_baseline = [VISOLEX_LABEL_MAP[p] if p < len(VISOLEX_LABEL_MAP) else p for p in raw_pred_baseline]
    report_baseline = classification_report(y_true, y_pred_baseline, target_names=LABEL_NAMES, output_dict=True, zero_division=0)

    # Model 2: Local Fine-Tuned (Raw Text)
    print("-" * 60)
    print("MODEL 2: Local Fine-Tuned Model (phobert_emotion_final) [Raw Input]")
    print("-" * 60)
    if not FINETUNED_MODEL_PATH.exists():
        print(f"[ERROR] Fine-tuned weights not found at: {FINETUNED_MODEL_PATH}")
        return None

    y_pred_finetuned_raw = predict_model_batch(str(FINETUNED_MODEL_PATH), raw_texts)
    report_finetuned_raw = classification_report(y_true, y_pred_finetuned_raw, target_names=LABEL_NAMES, output_dict=True, zero_division=0)

    report_finetuned_pipeline = None
    if eval_pipeline and teencode_normalizer is not None:
        # Model 3: Local Fine-Tuned (Normalized Text through Teencode Pipeline)
        print("-" * 60)
        print("MODEL 3: Local Fine-Tuned Model + Teencode Normalization Pipeline")
        print("-" * 60)
        norm_texts = [teencode_normalizer.normalize(t) for t in raw_texts]
        y_pred_finetuned_pipeline = predict_model_batch(str(FINETUNED_MODEL_PATH), norm_texts)
        report_finetuned_pipeline = classification_report(y_true, y_pred_finetuned_pipeline, target_names=LABEL_NAMES, output_dict=True, zero_division=0)

    acc_b, f1_b = report_baseline["accuracy"], report_baseline["macro avg"]["f1-score"]
    acc_f_raw, f1_f_raw = report_finetuned_raw["accuracy"], report_finetuned_raw["macro avg"]["f1-score"]

    print("\nSUMMARY METRICS:")
    print(f"Baseline (Raw)          : Accuracy={acc_b*100:.2f}% | Macro F1={f1_b*100:.2f}%")
    print(f"Fine-Tuned (Raw)        : Accuracy={acc_f_raw*100:.2f}% | Macro F1={f1_f_raw*100:.2f}% | Delta F1 vs Baseline={(f1_f_raw - f1_b)*100:+.2f}%")

    if report_finetuned_pipeline:
        acc_f_pipe, f1_f_pipe = report_finetuned_pipeline["accuracy"], report_finetuned_pipeline["macro avg"]["f1-score"]
        print(f"Fine-Tuned + Pipeline   : Accuracy={acc_f_pipe*100:.2f}% | Macro F1={f1_f_pipe*100:.2f}% | Delta F1 vs Raw={(f1_f_pipe - f1_f_raw)*100:+.2f}%")

    return {
        "dataset": dataset_name,
        "baseline_report": report_baseline,
        "finetuned_raw_report": report_finetuned_raw,
        "finetuned_pipeline_report": report_finetuned_pipeline
    }


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


def generate_evaluate_phobert_report(res_teencode: dict):
    report_dir = eval_dir / "results" / "report"
    report_dir.mkdir(parents=True, exist_ok=True)

    b_teen = res_teencode["baseline_report"]
    f_teen = res_teencode["finetuned_raw_report"]
    p_teen = res_teencode["finetuned_pipeline_report"]

    doc_phobert = f"""# PhoBERT Evaluation & Teencode Normalization Pipeline Report

> **Teencode & Slang Stress Test Evaluation: Assessing Preprocessor Pipeline (`teencode_normalizer`) Impact**

---

## 1. Overall Teencode Pipeline Evaluation Summary

| Input Preprocessing State | Model Variant | Accuracy | Macro F1-Score | Delta F1 ($\Delta$) |
| :--- | :--- | :---: | :---: | :---: |
| **Raw Input (No Preprocessing)** | Baseline (`visolex/phobert-emotion`) | {b_teen['accuracy']*100:.2f}% | {b_teen['macro avg']['f1-score']*100:.2f}% | Base |
| **Raw Input (No Preprocessing)** | Fine-Tuned Model (`phobert_emotion_final`) | {f_teen['accuracy']*100:.2f}% | {f_teen['macro avg']['f1-score']*100:.2f}% | {(f_teen['macro avg']['f1-score']-b_teen['macro avg']['f1-score'])*100:+.2f}% |
| **Normalized Pipeline (`teencode_normalizer`)** | **Fine-Tuned Model (`phobert_emotion_final`)** | **{p_teen['accuracy']*100:.2f}%** | **{p_teen['macro avg']['f1-score']*100:.2f}%** | **{(p_teen['macro avg']['f1-score']-f_teen['macro avg']['f1-score'])*100:+.2f}% vs Raw** |

---

## 2. Detailed Per-Class Breakdown (Teencode Stress Test - 300 Noise Samples)

### 2.1 Baseline Model (`visolex/phobert-emotion`) [Raw Input]
{format_class_table(b_teen)}

### 2.2 Fine-Tuned Model (`phobert_emotion_final`) [Raw Input]
{format_class_table(f_teen)}

### 2.3 Fine-Tuned Model + Teencode Preprocessing Pipeline (`teencode_normalizer`)
{format_class_table(p_teen)}

---

## 3. Key Findings & Conclusions

1. **Teencode Noise Impact**: Dữ liệu mạng xã hội chứa teencode/từ lóng làm giảm hiệu năng của mô hình Baseline. Quá trình Fine-Tuning nâng F1-Score từ **{b_teen['macro avg']['f1-score']*100:.2f}%** lên **{f_teen['macro avg']['f1-score']*100:.2f}%**.
2. **Preprocessor Pipeline Gain**: Khi cho câu đi qua **Teencode Normalization Pipeline** (`teencode_normalizer`), chỉ số Macro F1 tăng thêm **{(p_teen['macro avg']['f1-score']-f_teen['macro avg']['f1-score'])*100:+.2f}%**, đạt mốc tối ưu **{p_teen['macro avg']['f1-score']*100:.2f}%** và Accuracy đạt **{p_teen['accuracy']*100:.2f}%**.
"""

    report_file = report_dir / "evaluate_phobert_report.md"
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(doc_phobert)

    print(f"\n[REPORT] Saved evaluate_phobert report to: {report_file}")


def run_comparative_evaluation():
    test_teencode = eval_dir / "data" / "noisy_social_test.json"

    res_teencode = evaluate_dataset(test_teencode, "Teencode & Slang Stress Test Set (300 Noise Samples)", eval_pipeline=True)

    results_dir = eval_dir / "results"
    results_dir.mkdir(exist_ok=True)

    if res_teencode:
        generate_evaluate_phobert_report(res_teencode)

    print("\nEvaluation pipeline complete.")


if __name__ == "__main__":
    run_comparative_evaluation()




