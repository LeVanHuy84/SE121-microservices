"""
========================================================================================
VLM BENCHMARK EVALUATION RUNNER (SINGLE-LABEL MULTIMODAL SOCIAL MEDIA EMOTION)
========================================================================================
Dự án: SE121 Microservices Platform — Mạng xã hội hỗ trợ Sức khỏe Tâm thần (KLTN)
Tập đánh giá: evaluation/image-experiment/data/benchmark_gold_clean.json (678 mẫu sạch)

Tính năng an toàn & học thuật:
  1. CHẠY TỚI ĐÂU LƯU TỚI ĐÓ (Instant Incremental Checkpoint):
     - Ghi nhận kết quả từng mẫu vào benchmark_evaluation_results.json ngay khi nhận response.
     - Tự động resume (bỏ qua các mẫu đã chạy trước đó nếu bị gián đoạn/rớt mạng).
  2. RATE LIMIT GUARD:
     - Điều tiết delay (mặc định 4.2s tương ứng ~14-15 RPM cho gói Gemini Free Tier).
     - Tự động Exponential Backoff khi gặp mã HTTP 429 / 503.
  3. BÁO CÁO KHOA HỌC CHUẨN KLTN:
     - Bảng ma trận nhầm lẫn (Confusion Matrix 7x7).
     - Bóc tách F1, Precision, Recall cho từng lớp cảm xúc Ekman + neutral.
     - Tính Accuracy, Macro-F1, Weighted-F1.
     - Phân tích tương quan Mỉa mai / Xung đột Ảnh - Chữ (Sarcasm Detection).
     - Tự động xuất file Markdown báo cáo: data/vlm_benchmark_report.md
========================================================================================
"""

import os
import sys
import json
import time
import asyncio
import logging
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
import numpy as np
from PIL import Image

# Ensure UTF-8 output on Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("VLMBenchmark")

# Paths
BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent.parent
DATA_DIR = BASE_DIR / "data"
RESULTS_DIR = BASE_DIR / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

GOLD_CLEAN_FILE = DATA_DIR / "benchmark_gold_clean.json"
RESULTS_FILE = RESULTS_DIR / "benchmark_evaluation_results.json"
REPORT_MD_RESULTS = RESULTS_DIR / "vlm_benchmark_report.md"
REPORT_MD_DOCS = REPO_ROOT / "docs" / "outputs" / "bao_cao_lan_5" / "vlm_benchmark_report.md"

# Add ai-chatbot-service to path
AI_SERVICE_DIR = REPO_ROOT / "apps" / "ai-chatbot-service"
if str(AI_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(AI_SERVICE_DIR))

# Auto-load .env from either evaluation folder, ai-chatbot-service folder, or repo root
try:
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / ".env")
    load_dotenv(AI_SERVICE_DIR / ".env")
    load_dotenv(REPO_ROOT / ".env")
except ImportError:
    pass

try:
    from app.modules.analysis.services.ml_models.vlm.vlm_analyzer import (
        VLMAnalyzer,
        VALID_EMOTIONS
    )
except ImportError as e:
    logger.error(f"Lỗi import VLMAnalyzer: {e}. Vui lòng chạy bằng python trong môi trường của ai-chatbot-service.")
    VALID_EMOTIONS = ["joy", "sadness", "anger", "fear", "disgust", "surprise", "neutral"]


# ============================================================================
# 1. HELPER METRICS FUNCTIONS (PURE PYTHON + NUMPY)
# ============================================================================

def calculate_metrics(y_true: List[str], y_pred: List[str], classes: List[str]) -> Dict[str, Any]:
    """Tính toán Accuracy, Macro-F1, Weighted-F1, Per-class Precision/Recall/F1 và Confusion Matrix."""
    total = len(y_true)
    if total == 0:
        return {}

    class_to_idx = {c: i for i, c in enumerate(classes)}
    num_classes = len(classes)
    cm = np.zeros((num_classes, num_classes), dtype=int)

    for yt, yp in zip(y_true, y_pred):
        if yt in class_to_idx and yp in class_to_idx:
            cm[class_to_idx[yt]][class_to_idx[yp]] += 1

    correct = np.trace(cm)
    accuracy = correct / total if total > 0 else 0.0

    per_class = {}
    f1_list = []
    support_list = []

    for i, c in enumerate(classes):
        tp = cm[i][i]
        fp = np.sum(cm[:, i]) - tp
        fn = np.sum(cm[i, :]) - tp
        support = int(np.sum(cm[i, :]))
        support_list.append(support)

        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0
        f1_list.append(f1)

        per_class[c] = {
            "precision": round(float(prec), 4),
            "recall": round(float(rec), 4),
            "f1": round(float(f1), 4),
            "support": support,
            "tp": int(tp),
            "fp": int(fp),
            "fn": int(fn)
        }

    macro_f1 = float(np.mean(f1_list))
    total_support = sum(support_list)
    weighted_f1 = float(sum(f * s for f, s in zip(f1_list, support_list)) / total_support) if total_support > 0 else 0.0

    return {
        "total_samples": total,
        "accuracy": round(float(accuracy), 4),
        "macro_f1": round(macro_f1, 4),
        "weighted_f1": round(weighted_f1, 4),
        "per_class": per_class,
        "confusion_matrix": cm.tolist(),
        "classes": classes
    }


def generate_markdown_report(
    metrics: Dict[str, Any],
    model_name: str,
    sarcasm_metrics: Dict[str, Any],
    latency_info: Dict[str, Any]
) -> str:
    """Tạo báo cáo chi tiết định dạng Markdown chuẩn cho KLTN."""
    classes = metrics.get("classes", VALID_EMOTIONS)
    cm = metrics.get("confusion_matrix", [])
    per_class = metrics.get("per_class", {})

    now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    md = f"""# Báo Cáo Thực Nghiệm Đánh Giá Mô Hình VLM ({model_name})

**Đề tài:** Nhận diện và Phân tích Cảm xúc Đa phương thức trên Mạng Xã Hội (KLTN SE121)  
**Thời gian thực hiện:** {now_str}  
**Mô hình VLM:** `{model_name}`  
**Tập kiểm thử:** Chuẩn Vàng Đơn Nhãn Benchmark (SE121 Gold Test Set)  
**Quy mô mẫu đánh giá:** **{metrics.get('total_samples', 0)}** mẫu sạch (đã loại bỏ các mẫu gắn cờ lỗi ngữ cảnh).  

---

## 1. Bảng Tổng Hợp Chỉ Số Hiệu Năng Cốt Lõi

| Chỉ số Đánh Giá | Kết quả Thực Nghiệm | Đánh giá Chuẩn Học Thuật |
| :--- | :---: | :--- |
| **Accuracy (Độ chính xác toàn thể)** | **{metrics.get('accuracy', 0.0) * 100:.2f}%** | Tỷ lệ dự đoán đúng nhãn cảm xúc chính xác 1-1 với Chuẩn vàng |
| **Macro-F1 Score** | **{metrics.get('macro_f1', 0.0):.4f}** | Trung bình không trọng số (phản ánh công bằng cả các lớp hiếm) |
| **Weighted-F1 Score** | **{metrics.get('weighted_f1', 0.0):.4f}** | Trung bình có trọng số theo phân phối mẫu thực tế |
| **Độ trễ trung bình (Latency)** | **{latency_info.get('avg_seconds', 0.0):.2f}s** / bài | Thời gian xử lý nén ảnh + gọi API VLM |
| **Độ chính xác phát hiện Mỉa mai (Sarcasm)** | **{sarcasm_metrics.get('accuracy', 0.0) * 100:.2f}%** | Nhận diện xung đột đối lập giữa hình ảnh và ngữ nghĩa văn bản |

---

## 2. Bóc Tách Chi Tiết Theo Từng Lớp Cảm Xúc (Per-Class Breakdown)

> [!NOTE]
> Bảng bóc tách phân tích sâu theo yêu cầu của GVHD để đánh giá khả năng nhận diện các cảm xúc tiêu cực và các cặp cảm xúc dễ lẫn lộn trên mạng xã hội.

| Nhãn Cảm Xúc | Precision | Recall | F1-Score | Số lượng mẫu (Support) | Đánh giá năng lực mô hình |
| :--- | :---: | :---: | :---: | :---: | :--- |
"""
    for c in classes:
        info = per_class.get(c, {})
        f1_val = info.get("f1", 0.0)
        note = "Rất tốt (≥ 0.80)" if f1_val >= 0.80 else ("Khá tốt (≥ 0.70)" if f1_val >= 0.70 else "Cần theo dõi (< 0.70)")
        md += f"| **`{c}`** | {info.get('precision', 0.0):.4f} | {info.get('recall', 0.0):.4f} | **{f1_val:.4f}** | {info.get('support', 0)} | {note} |\n"

    md += """
---

## 3. Ma Trận Nhầm Lẫn (Confusion Matrix 7x7)

Hàng ngang là **Nhãn Chuẩn Vàng (Ground Truth)**, Cột dọc là **Nhãn Dự Đoán của VLM (Predicted)**:

| Ground Truth \\ Predict | """ + " | ".join(f"`{c}`" for c in classes) + """ | **Tổng GT (Support)** | **Recall (%)** |
| :--- | """ + " | ".join([":---:"] * len(classes)) + """ | :---: | :---: |
"""

    for i, c_true in enumerate(classes):
        row_str = f"| **`{c_true}`** | "
        row_vals = []
        row_total = sum(cm[i]) if i < len(cm) else 0
        correct_val = cm[i][i] if i < len(cm) and i < len(cm[i]) else 0
        rec_pct = (correct_val / row_total * 100) if row_total > 0 else 0.0

        for j in range(len(classes)):
            val = cm[i][j] if i < len(cm) and j < len(cm[i]) else 0
            if i == j:
                row_vals.append(f"**{val}**")
            else:
                row_vals.append(str(val) if val > 0 else "-")
        row_str += " | ".join(row_vals) + f" | **{row_total}** | **{rec_pct:.1f}%** |\n"
        md += row_str

    pred_totals = []
    for j in range(len(classes)):
        p_tot = sum(cm[k][j] for k in range(len(classes))) if cm else 0
        pred_totals.append(str(p_tot))
    all_total = metrics.get('total_samples', 0)
    acc_pct = metrics.get('accuracy', 0.0) * 100
    md += f"| **Tổng Pred** | " + " | ".join(f"**{pt}**" for pt in pred_totals) + f" | **{all_total}** | **Acc: {acc_pct:.1f}%** |\n"

    md += f"""
---

## 4. Phân Tích Nhận Diện Mỉa Mai & Xung Đột Ảnh-Chữ (Sarcasm Analysis)

- **Tổng số mẫu có yếu tố mỉa mai (`INCONGRUENT`):** {sarcasm_metrics.get('total_sarcastic', 0)} mẫu.
- **VLM phát hiện chính xác (`is_sarcasm_or_conflict = True`):** {sarcasm_metrics.get('true_sarcastic_detected', 0)} mẫu ({sarcasm_metrics.get('sarcasm_recall', 0.0) * 100:.1f}%).
- **Mẫu bình thường (ảnh minh họa/bổ trợ) không bị báo động giả:** {sarcasm_metrics.get('normal_correct', 0)} / {sarcasm_metrics.get('total_normal', 0)} mẫu ({sarcasm_metrics.get('normal_specificity', 0.0) * 100:.1f}%).

---

*Báo cáo được sinh tự động bởi pipeline kiểm thử thực nghiệm `evaluation/image-experiment/run_vlm_benchmark.py`.*
"""
    return md


# ============================================================================
# 2. RUNNER MAIN PIPELINE
# ============================================================================

async def run_benchmark(
    max_samples: Optional[int] = None,
    delay_seconds: float = 4.2,
    model_override: Optional[str] = None,
    api_key_override: Optional[str] = None,
    base_url_override: Optional[str] = None,
    report_only: bool = False
):
    """Thực thi luồng đánh giá toàn diện trên tập Benchmark sạch."""
    if not GOLD_CLEAN_FILE.exists():
        logger.error(f"Không tìm thấy file benchmark sạch: {GOLD_CLEAN_FILE}")
        logger.info("Đang tự động xuất file benchmark sạch...")
        try:
            import prepare_multimodal_dataset
            prepare_multimodal_dataset.export_clean_benchmark()
        except Exception as e:
            logger.error(f"Lỗi tạo file sạch: {e}")
            return

    with open(GOLD_CLEAN_FILE, "r", encoding="utf-8") as f:
        clean_dataset = json.load(f)

    logger.info(f"Đã nạp {len(clean_dataset)} mẫu chuẩn vàng từ {GOLD_CLEAN_FILE.name}")

    # Load existing results for instant checkpointing / resume
    completed_results: Dict[str, Any] = {}
    if RESULTS_FILE.exists():
        try:
            with open(RESULTS_FILE, "r", encoding="utf-8") as f:
                completed_results = json.load(f)
            logger.info(f"Đã phát hiện checkpoint trước đó: {len(completed_results)} mẫu đã hoàn thành.")
        except Exception as e:
            logger.warning(f"Lỗi đọc checkpoint cũ: {e}. Sẽ khởi tạo mới.")

    vlm = VLMAnalyzer()
    if api_key_override:
        vlm.api_key = api_key_override
        logger.info("[Auth] Áp dụng VLM API Key override từ tham số lệnh.")
    if base_url_override:
        vlm.base_url = base_url_override
        logger.info(f"[Auth] Áp dụng VLM Base URL override: {vlm.base_url}")
    if model_override:
        vlm.model_name = model_override
        logger.info(f"Áp dụng cấu hình model override: {vlm.model_name}")

    target_samples = clean_dataset
    if max_samples:
        target_samples = clean_dataset[:max_samples]
        logger.info(f"Giới hạn chạy thử: {max_samples} mẫu.")

    unprocessed = [s for s in target_samples if s["id"] not in completed_results]

    if not report_only and unprocessed:
        logger.info("=" * 80)
        logger.info(f"BẮT ĐẦU CHẠY BENCHMARK VLM: {len(unprocessed)} mẫu còn lại (Model: {vlm.model_name})")
        logger.info(f"Cơ chế an toàn: Chạy tới đâu lưu ngay tới đó | Tốc độ: ~{60 / delay_seconds:.1f} RPM")
        logger.info("=" * 80)

        for idx, sample in enumerate(unprocessed, start=1):
            sid = sample["id"]
            text_input = sample.get("text_vi") or sample.get("text") or ""
            img_rel_path = sample.get("image_path", "")
            
            # Resolve absolute image path
            img_full_path = REPO_ROOT / img_rel_path.replace("\\", "/")
            if not img_full_path.exists():
                img_full_path = DATA_DIR / "images" / Path(img_rel_path).name

            logger.info(f"[{idx}/{len(unprocessed)}] Phân tích mẫu {sid} (Ảnh: {img_full_path.name})...")
            start_t = time.time()

            try:
                if not img_full_path.exists():
                    logger.warning(f"  [Cảnh báo] Không tìm thấy ảnh cho mẫu {sid}: {img_full_path}")
                    images = []
                else:
                    images = [str(img_full_path)]

                # Call VLM
                vlm_res = await vlm.analyze_post(text_content=text_input, image_inputs=images)
                elapsed = round(time.time() - start_t, 3)

                pred_record = {
                    "id": sid,
                    "predicted_primary_emotion": vlm_res.get("primaryEmotion", "neutral"),
                    "final_confidence": vlm_res.get("finalConfidence", 0.0),
                    "emotion_scores": vlm_res.get("emotionScores", {}),
                    "is_sarcasm_or_conflict": vlm_res.get("isSarcasmOrConflict", False),
                    "conflict_explanation": vlm_res.get("conflictExplanation", ""),
                    "content_moderation": vlm_res.get("contentModeration", {}),
                    "mental_health_risk_level": vlm_res.get("mentalHealthRiskLevel", "none"),
                    "latency_seconds": elapsed,
                    "model_used": vlm.model_name,
                    "evaluated_at": datetime.now().isoformat()
                }

                # Save into checkpoint memory
                completed_results[sid] = pred_record

                # Instant persistent save via temporary atomic swap
                temp_res = RESULTS_FILE.with_suffix(".tmp")
                with open(temp_res, "w", encoding="utf-8") as f:
                    json.dump(completed_results, f, ensure_ascii=False, indent=2)
                temp_res.replace(RESULTS_FILE)

                gold_emo = sample.get("ground_truth", {}).get("combined_emotion", "")
                pred_emo = pred_record["predicted_primary_emotion"]
                is_match = "✓ ĐÚNG" if gold_emo == pred_emo else "✗ KHÁC"
                logger.info(f"  -> Hoàn thành trong {elapsed}s | VLM: {pred_emo} vs Chuẩn: {gold_emo} ({is_match})")

            except Exception as e:
                logger.error(f"  -> Lỗi khi phân tích mẫu {sid}: {e}")
                # Chờ backoff nếu lỗi mạng hoặc rate limit
                await asyncio.sleep(10.0)

            # Delay to respect RPM limit
            await asyncio.sleep(delay_seconds)

        await vlm.close()

    # ========================================================================
    # 3. METRIC EVALUATION & REPORT GENERATION
    # ========================================================================
    logger.info("\n" + "=" * 80)
    logger.info("  TỔNG HỢP & ĐO ĐẠC CHỈ SỐ KHOA HỌC (EVALUATION METRICS)")
    logger.info("=" * 80)

    y_true = []
    y_pred = []
    latencies = []
    
    sarcasm_stats = {
        "total_sarcastic": 0,
        "true_sarcastic_detected": 0,
        "total_normal": 0,
        "normal_correct": 0
    }

    sample_map = {s["id"]: s for s in clean_dataset}

    for sid, pred in completed_results.items():
        if sid not in sample_map:
            continue
        gold_item = sample_map[sid]
        gt = gold_item.get("ground_truth", {})
        
        gold_emo = gt.get("combined_emotion", "neutral")
        pred_emo = pred.get("predicted_primary_emotion", "neutral")

        y_true.append(gold_emo)
        y_pred.append(pred_emo)
        latencies.append(pred.get("latency_seconds", 0.0))

        # Sarcasm check
        is_sarcastic_gold = (gt.get("relationship_type") in ("INCONGRUENT", "INCONGRUENT_SARCASTIC"))
        is_sarcastic_pred = pred.get("is_sarcasm_or_conflict", False)

        if is_sarcastic_gold:
            sarcasm_stats["total_sarcastic"] += 1
            if is_sarcastic_pred:
                sarcasm_stats["true_sarcastic_detected"] += 1
        else:
            sarcasm_stats["total_normal"] += 1
            if not is_sarcastic_pred:
                sarcasm_stats["normal_correct"] += 1

    if not y_true:
        logger.warning("Chưa có kết quả mẫu nào để tổng hợp chỉ số.")
        return

    metrics = calculate_metrics(y_true, y_pred, VALID_EMOTIONS)

    # Calculate sarcasm rates
    s_tot = sarcasm_stats["total_sarcastic"]
    sarcasm_recall = sarcasm_stats["true_sarcastic_detected"] / s_tot if s_tot > 0 else 0.0
    n_tot = sarcasm_stats["total_normal"]
    normal_spec = sarcasm_stats["normal_correct"] / n_tot if n_tot > 0 else 0.0
    sarcasm_acc = (sarcasm_stats["true_sarcastic_detected"] + sarcasm_stats["normal_correct"]) / len(y_true) if y_true else 0.0

    sarcasm_analysis = {
        "accuracy": round(sarcasm_acc, 4),
        "total_sarcastic": s_tot,
        "true_sarcastic_detected": sarcasm_stats["true_sarcastic_detected"],
        "sarcasm_recall": round(sarcasm_recall, 4),
        "total_normal": n_tot,
        "normal_correct": sarcasm_stats["normal_correct"],
        "normal_specificity": round(normal_spec, 4)
    }

    latency_info = {
        "avg_seconds": round(float(np.mean(latencies)), 2) if latencies else 0.0,
        "min_seconds": round(float(np.min(latencies)), 2) if latencies else 0.0,
        "max_seconds": round(float(np.max(latencies)), 2) if latencies else 0.0
    }

    # Print summary to console
    print("\n" + "-" * 70)
    print(f"  MÔ HÌNH: {vlm.model_name.upper()} | TỔNG MẪU: {len(y_true)}")
    print("-" * 70)
    print(f"  Accuracy (Độ chính xác toàn thể): {metrics['accuracy'] * 100:.2f}%")
    print(f"  Macro-F1 Score:                   {metrics['macro_f1']:.4f}")
    print(f"  Weighted-F1 Score:                {metrics['weighted_f1']:.4f}")
    print(f"  Độ trễ trung bình:                {latency_info['avg_seconds']:.2f}s / bài")
    print(f"  Phát hiện Mỉa mai (Sarcasm Acc):  {sarcasm_analysis['accuracy'] * 100:.2f}% (Recall: {sarcasm_analysis['sarcasm_recall'] * 100:.1f}%)")
    print("-" * 70)
    print("  BẢNG F1 THEO TỪNG LỚP CẢM XÚC (EKMAN 6 + NEUTRAL):")
    for c in VALID_EMOTIONS:
        info = metrics["per_class"][c]
        print(f"    - {c.upper():<10}: F1={info['f1']:.4f} | Prec={info['precision']:.4f} | Rec={info['recall']:.4f} | N={info['support']}")
    print("-" * 70)

    # In Ma trận nhầm lẫn (Confusion Matrix 7x7) ra terminal
    print("\n" + "=" * 80)
    print("  MA TRẬN NHẦM LẪN (CONFUSION MATRIX 7x7):")
    print("  Hàng ngang: Ground Truth (Chuẩn vàng) | Cột dọc: Predicted (VLM dự đoán)")
    print("-" * 80)
    header_cols = [c[:4] for c in VALID_EMOTIONS]
    gt_col_title = "GT / PRED"
    print(f"  {gt_col_title:<10} | " + " | ".join(f"{ch:>5}" for ch in header_cols) + " |  Total | Recall")
    print("  " + "-" * 75)
    cm_matrix = metrics.get("confusion_matrix", [])
    for i, c_true in enumerate(VALID_EMOTIONS):
        row_vals = [f"{cm_matrix[i][j]:>5}" for j in range(len(VALID_EMOTIONS))]
        row_tot = sum(cm_matrix[i])
        rec = (cm_matrix[i][i] / row_tot * 100) if row_tot > 0 else 0.0
        print(f"  {c_true:<10} | " + " | ".join(row_vals) + f" | {row_tot:>6} | {rec:>5.1f}%")
    print("  " + "-" * 75)
    col_tots = [f"{sum(cm_matrix[k][j] for k in range(len(VALID_EMOTIONS))):>5}" for j in range(len(VALID_EMOTIONS))]
    print(f"  {'Total Pred':<10} | " + " | ".join(col_tots) + f" | {len(y_true):>6} |")
    print("=" * 80)

    # Generate Markdown Report
    md_content = generate_markdown_report(metrics, vlm.model_name, sarcasm_analysis, latency_info)

    with open(REPORT_MD_RESULTS, "w", encoding="utf-8") as f:
        f.write(md_content)
    logger.info(f"✓ Đã xuất báo cáo Markdown tại: {REPORT_MD_RESULTS}")

    try:
        REPORT_MD_DOCS.parent.mkdir(parents=True, exist_ok=True)
        with open(REPORT_MD_DOCS, "w", encoding="utf-8") as f:
            f.write(md_content)
        logger.info(f"✓ Đã sao chép báo cáo Markdown vào thư mục báo cáo: {REPORT_MD_DOCS}")
    except Exception as e:
        logger.warning(f"Không thể sao chép sang docs: {e}")


def main():
    parser = argparse.ArgumentParser(description="Chạy Benchmark VLM trên tập Chuẩn Vàng Đơn Nhãn SE121.")
    parser.add_argument("--max-samples", type=int, default=None, help="Số lượng mẫu tối đa cần chạy (mặc định: toàn bộ).")
    parser.add_argument("--delay", type=float, default=4.2, help="Số giây nghỉ giữa các request (mặc định 4.2s tương ứng 14-15 RPM).")
    parser.add_argument("--model", type=str, default=None, help="Tên model override (vd: gemini-3.5-flash-lite).")
    parser.add_argument("--api-key", type=str, default=None, help="VLM API Key override.")
    parser.add_argument("--base-url", type=str, default=None, help="VLM Base URL override.")
    parser.add_argument("--report-only", action="store_true", help="Chỉ tính toán và xuất báo cáo từ file kết quả đã có, không gọi API.")

    args = parser.parse_args()

    asyncio.run(run_benchmark(
        max_samples=args.max_samples,
        delay_seconds=args.delay,
        model_override=args.model,
        api_key_override=args.api_key,
        base_url_override=args.base_url,
        report_only=args.report_only
    ))


if __name__ == "__main__":
    main()
