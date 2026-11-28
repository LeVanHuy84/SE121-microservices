"""Calculates Inter-Rater Reliability (Cohen's Kappa, PABAK & Spearman Correlation)
between Human Experts and Google Gemini LLM-as-a-Judge.

Meets the scientific rigor requirements of Section 6 in docs/evaluation/04_chatbot_llm_as_a_judge.md:
  - Inter-Annotator Agreement: Human 1 vs Human 2 (Chứng minh 2 chuyên gia độc lập có sự đồng thuận cao).
  - Human vs Gemini Judge Agreement: Đo lường mức độ tin cậy của mô hình giám khảo.
Supports both Single-Turn (100 cases) and Multi-Turn (18 scenarios).
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
MULTI_JUDGMENTS_FILE = RESULTS_DIR / "multi_turn_judgments.json"


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
        pe += a_prob * b_prob

    if math.isclose(pe, 1.0):
        kappa = 1.0
    else:
        kappa = (po - pe) / (1.0 - pe)

    return kappa, po, pe


def calculate_pabak(po: float) -> float:
    """Calculates Prevalence-Adjusted and Bias-Adjusted Kappa (Byrt et al., 1993).
    Addresses the well-known Kappa Paradox when one category has very high prevalence.
    """
    return 2.0 * po - 1.0


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


def evaluate_pair(name_a: str, map_a: Dict[str, Any], name_b: str, map_b: Dict[str, Any], metrics: List[str]):
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

    # Cohen's Kappa & PABAK
    kappa, po, pe = calculate_cohen_kappa(verdicts_a, verdicts_b)
    pabak = calculate_pabak(po)
    # Spearman Overall
    r_overall = calculate_spearman_correlation(scores_overall_a, scores_overall_b)

    print(f"    - Tỷ lệ đồng thuận quan sát (Po) : {po * 100:.1f}% ({sum(1 for a, b in zip(verdicts_a, verdicts_b) if a == b)}/{n} ca)")
    print(f"    - Hệ số Cohen's Kappa (κ)         : {kappa:.3f}")
    if kappa >= 0.81:
        desc = "Đồng thuận gần như hoàn hảo (Almost Perfect)"
    elif kappa >= 0.61:
        desc = "Đồng thuận đáng kể (Substantial Agreement - Đạt chuẩn KLTN)"
    elif kappa >= 0.41:
        desc = "Đồng thuận trung bình (Moderate)"
    else:
        desc = "Đồng thuận thấp / Hiện tượng Kappa Paradox (Do tỷ lệ Pass áp đảo)"
    print(f"      -> Đánh giá Cohen's Kappa: {desc}")
    print(f"    - Chỉ số PABAK (Hiệu chỉnh tỷ lệ): PABAK = {pabak:.3f} (Khắc phục nghịch lý Kappa)")

    print(f"    - Tương quan Spearman điểm tổng   : r_s = {r_overall:.3f}")
    for m in metrics:
        r_m = calculate_spearman_correlation(metric_pairs[m][0], metric_pairs[m][1])
        print(f"      * Trục {m:<20}: r_s = {r_m:.3f}")


def load_file_map(path: Path) -> Dict[str, Any]:
    if not path.exists() or path.stat().st_size == 0:
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                # Detect VLM format collision
                if "reviewer_info" in data and "samples" in data:
                    return {}
                return data
            if isinstance(data, list):
                # Check for single turn or multi turn
                res = {}
                for r in data:
                    if isinstance(r, dict):
                        cid = r.get("case_id") or r.get("dialogue_id")
                        if cid:
                            res[cid] = r
                return res
    except Exception:
        pass
    return {}


def run_benchmark_mode(mode_name: str, judgments_file: Path, pattern: str, metrics: List[str]):
    print("\n" + "=" * 78)
    print(f"  PHÂN TÍCH ĐỒNG THUẬN: {mode_name.upper()}")
    print("=" * 78)

    llm_map = load_file_map(judgments_file)
    print(f"[*] Gemini LLM Judgments : {len(llm_map)} ca ({judgments_file.name})")

    human_files = sorted(list(RESULTS_DIR.glob(pattern)))
    if not human_files:
        print(f"[!] Không tìm thấy file đánh giá người nào cho mẫu: {pattern}")
        return

    reviewers: Dict[str, Dict[str, Any]] = {}
    for hf in human_files:
        r_map = load_file_map(hf)
        prefix = f"human_eval_{'single' if 'single' in pattern else 'multi'}_"
        name = hf.stem.replace(prefix, "").replace("_", " ").title()
        if not r_map:
            # Check why it's empty
            with open(hf, "r", encoding="utf-8") as f:
                raw_d = json.load(f)
            if isinstance(raw_d, dict) and "reviewer_info" in raw_d:
                print(f"[!] Chuyên gia: [{name}] — Tệp {hf.name} chứa dữ liệu VLM ({raw_d.get('reviewer_info', {}).get('reviewed_count')} mẫu ELITE), chưa chứa ca {mode_name}!")
            else:
                print(f"[!] Chuyên gia: [{name}] — Tệp {hf.name} rỗng hoặc không đúng định dạng.")
            continue
        reviewers[name] = r_map
        print(f"[*] Chuyên gia: [{name}] — {len(r_map)} ca đã chấm ({hf.name})")

    # 1. Human vs Human
    reviewer_names = list(reviewers.keys())
    if len(reviewer_names) >= 2:
        print("\n" + "-" * 60)
        print("  1. ĐỒNG THUẬN GIỮA CÁC CHUYÊN GIA CON NGƯỜI (HUMAN VS HUMAN)")
        print("-" * 60)
        for i in range(len(reviewer_names)):
            for j in range(i + 1, len(reviewer_names)):
                name_1 = reviewer_names[i]
                name_2 = reviewer_names[j]
                evaluate_pair(name_1, reviewers[name_1], name_2, reviewers[name_2], metrics)
    elif len(reviewer_names) == 1:
        print(f"\n[-] Chỉ có 1 chuyên gia hoàn tất ({reviewer_names[0]}), chưa thể tính Human vs Human.")

    # 2. Human vs Gemini Judge
    if llm_map and reviewers:
        print("\n" + "-" * 60)
        print("  2. ĐỒNG THUẬN GIỮA CON NGƯỜI VÀ MÔ HÌNH GIÁM KHẢO (HUMAN VS GEMINI JUDGE)")
        print("-" * 60)
        for name, r_map in reviewers.items():
            evaluate_pair(name, r_map, "Gemini LLM Judge", llm_map, metrics)


def main():
    print("=" * 78)
    print("  SENTIMETA ASSISTANT — ĐỐI SOÁT ĐỘ TIN CẬY ĐỒNG THUẬN (INTER-RATER RELIABILITY)")
    print("=" * 78)

    single_metrics = ["faithfulness", "relevance", "empathy", "clinical_safety"]
    multi_metrics = ["faithfulness", "relevance", "empathy", "clinical_safety", "context_consistency"]

    # Run Single-Turn
    run_benchmark_mode("Single-Turn (Đơn lượt - 100 ca)", SINGLE_JUDGMENTS_FILE, "human_eval_single_*.json", single_metrics)

    # Run Multi-Turn
    run_benchmark_mode("Multi-Turn (Đa lượt - 18 kịch bản)", MULTI_JUDGMENTS_FILE, "human_eval_multi_*.json", multi_metrics)

    print("\n" + "=" * 78)
    print("[+] Hoàn tất tính toán chỉ số thống kê Inter-Rater Reliability!")


if __name__ == "__main__":
    main()
