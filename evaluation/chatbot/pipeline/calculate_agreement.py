"""Calculates Inter-Rater Reliability (Cohen's Kappa & Spearman Correlation)
between Human Experts and Google Gemini LLM-as-a-Judge.

Meets the scientific rigor requirements of Section 6 in docs/evaluation/04_chatbot_llm_as_a_judge.md:
  - Inter-Annotator Agreement: Human 1 vs Human 2 (Chứng minh 2 chuyên gia độc lập có sự đồng thuận cao).
  - Human vs Gemini Judge Agreement: Đo lường mức độ tin cậy của mô hình giám khảo.
Zero external dependencies (uses standard library math).
"""

import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

CHATBOT_EVAL_DIR = Path(__file__).resolve().parent.parent
RESULTS_DIR = CHATBOT_EVAL_DIR / "results"
SINGLE_JUDGMENTS_FILE = RESULTS_DIR / "single_turn_judgments.json"


def calculate_cohen_kappa(verdicts_a: List[str], verdicts_b: List[str]) -> Tuple[float, float, float]:
    """Calculates Cohen's Kappa for categorical agreement."""
    n = len(verdicts_a)
    if n == 0:
        return 0.0, 0.0, 0.0

    categories = sorted(list(set(verdicts_a + verdicts_b)))
    agreements = sum(1 for a, b in zip(verdicts_a, verdicts_b) if a == b)
    po = agreements / n

    pe = 0.0
    for cat in categories:
        a_prob = sum(1 for a in verdicts_a if a == cat) / n
        b_prob = sum(1 for b in verdicts_b if b == cat) / n
        pe += (a_prob * b_prob)

    if math.isclose(pe, 1.0):
        kappa = 1.0
    else:
        kappa = (po - pe) / (1.0 - pe)

    return kappa, po, pe


def calculate_spearman_correlation(x: List[float], y: List[float]) -> float:
    """Calculates Spearman rank correlation coefficient without requiring scipy."""
    n = len(x)
    if n < 2:
        return 0.0

    def rank(arr):
        sorted_indices = sorted(range(len(arr)), key=lambda k: arr[k])
        ranks = [0.0] * len(arr)
        i = 0
        while i < len(arr):
            j = i
            while j < len(arr) - 1 and arr[sorted_indices[j]] == arr[sorted_indices[j + 1]]:
                j += 1
            avg_rank = (i + 1 + j + 1) / 2.0
            for k in range(i, j + 1):
                ranks[sorted_indices[k]] = avg_rank
            i = j + 1
        return ranks

    rx = rank(x)
    ry = rank(y)

    mean_rx = sum(rx) / n
    mean_ry = sum(ry) / n

    numerator = sum((rx[i] - mean_rx) * (ry[i] - mean_ry) for i in range(n))
    denom_x = math.sqrt(sum((rx[i] - mean_rx) ** 2 for i in range(n)))
    denom_y = math.sqrt(sum((ry[i] - mean_ry) ** 2 for i in range(n)))

    if denom_x * denom_y == 0:
        return 0.0
    return numerator / (denom_x * denom_y)


def evaluate_pair(name_a: str, map_a: Dict[str, Any], name_b: str, map_b: Dict[str, Any]):
    overlap_ids = [cid for cid in map_a if cid in map_b]
    n = len(overlap_ids)

    print(f"\n>>> Đối soát: [{name_a}] VS [{name_b}] (Số ca trùng khớp N = {n})")
    if n < 2:
        print("    [!] Chưa đủ số ca trùng khớp để tính thống kê (cần ít nhất 2 ca).")
        return

    verdicts_a = []
    verdicts_b = []
    scores_overall_a = []
    scores_overall_b = []

    metrics = ["faithfulness", "relevance", "empathy", "clinical_safety"]
    metric_pairs = {m: ([], []) for m in metrics}

    for cid in overlap_ids:
        rec_a = map_a[cid]
        rec_b = map_b[cid]

        # Extract verdict
        v_a = rec_a.get("verdict") or rec_a.get("judgment", {}).get("overall_verdict", "FAIL")
        v_b = rec_b.get("verdict") or rec_b.get("judgment", {}).get("overall_verdict", "FAIL")
        verdicts_a.append(v_a)
        verdicts_b.append(v_b)

        # Extract scores
        s_a = rec_a.get("scores") or rec_a.get("judgment", {}).get("scores", {})
        s_b = rec_b.get("scores") or rec_b.get("judgment", {}).get("scores", {})

        avg_a = sum(float(s_a.get(m, 0)) for m in metrics) / len(metrics)
        avg_b = sum(float(s_b.get(m, 0)) for m in metrics) / len(metrics)
        scores_overall_a.append(avg_a)
        scores_overall_b.append(avg_b)

        for m in metrics:
            metric_pairs[m][0].append(float(s_a.get(m, 0)))
            metric_pairs[m][1].append(float(s_b.get(m, 0)))

    # Cohen's Kappa
    kappa, po, pe = calculate_cohen_kappa(verdicts_a, verdicts_b)
    # Spearman Overall
    r_overall = calculate_spearman_correlation(scores_overall_a, scores_overall_b)

    print(f"    - Tỷ lệ đồng thuận quan sát (Po) : {po * 100:.1f}%")
    print(f"    - Hệ số Cohen's Kappa (κ)         : {kappa:.3f}")
    if kappa >= 0.81:
        desc = "Đồng thuận gần như hoàn hảo (Almost Perfect)"
    elif kappa >= 0.61:
        desc = "Đồng thuận đáng kể (Substantial Agreement - Đạt chuẩn KLTN)"
    elif kappa >= 0.41:
        desc = "Đồng thuận trung bình (Moderate)"
    else:
        desc = "Đồng thuận thấp (Fair/Poor)"
    print(f"      -> Đánh giá: {desc}")

    print(f"    - Tương quan Spearman điểm tổng   : r_s = {r_overall:.3f}")
    for m in metrics:
        r_m = calculate_spearman_correlation(metric_pairs[m][0], metric_pairs[m][1])
        print(f"      * Trục {m:<18}: r_s = {r_m:.3f}")


def load_file_map(path: Path) -> Dict[str, Any]:
    if not path.exists() or path.stat().st_size == 0:
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
            if isinstance(data, list):
                return {r["case_id"]: r for r in data if "case_id" in r}
    except Exception:
        pass
    return {}


def main():
    print("=" * 75)
    print("  SENTIMETA ASSISTANT — ĐỐI SOÁT ĐỘ TIN CẬY ĐỒNG THUẬN (INTER-RATER RELIABILITY)")
    print("=" * 75)

    # 1. Load LLM Judgments
    llm_map = load_file_map(SINGLE_JUDGMENTS_FILE)
    print(f"[*] Gemini LLM Judgments : {len(llm_map)} ca đã chấm ({SINGLE_JUDGMENTS_FILE.name})")

    # 2. Find all human reviewer files
    human_files = list(RESULTS_DIR.glob("human_eval_single_*.json"))
    legacy_file = RESULTS_DIR / "human_evaluations.json"
    if legacy_file.exists() and legacy_file not in human_files:
        human_files.append(legacy_file)

    if not human_files:
        print("[!] Chưa tìm thấy file đánh giá chuyên gia con người nào.")
        print("Vui lòng mở giao diện HITL (http://localhost:8080) và chấm điểm một số mẫu trước!")
        sys.exit(0)

    reviewers: Dict[str, Dict[str, Any]] = {}
    for hf in human_files:
        r_map = load_file_map(hf)
        if r_map:
            # Extract friendly reviewer name from filename
            name = hf.stem.replace("human_eval_single_", "").replace("_", " ").title()
            reviewers[name] = r_map
            print(f"[*] Chuyên gia: [{name}] — {len(r_map)} ca đã chấm ({hf.name})")

    # A. If >= 2 human reviewers, calculate Inter-Annotator Agreement (Human vs Human)
    reviewer_names = list(reviewers.keys())
    if len(reviewer_names) >= 2:
        print("\n" + "=" * 75)
        print("  A. ĐỒNG THUẬN GIỮA CÁC CHUYÊN GIA CON NGƯỜI (HUMAN VS HUMAN)")
        print("=" * 75)
        for i in range(len(reviewer_names)):
            for j in range(i + 1, len(reviewer_names)):
                name_1 = reviewer_names[i]
                name_2 = reviewer_names[j]
                evaluate_pair(name_1, reviewers[name_1], name_2, reviewers[name_2])

    # B. Compare each human reviewer against Gemini LLM Judge
    if llm_map:
        print("\n" + "=" * 75)
        print("  B. ĐỒNG THUẬN GIỮA CON NGƯỜI VÀ MÔ HÌNH GIÁM KHẢO (HUMAN VS GEMINI JUDGE)")
        print("=" * 75)
        for name, r_map in reviewers.items():
            evaluate_pair(name, r_map, "Gemini LLM Judge", llm_map)

    print("\n" + "=" * 75)
    print("[+] Số liệu phân tích sẵn sàng để đưa vào Báo cáo Khóa luận Tốt nghiệp!")


if __name__ == "__main__":
    main()
