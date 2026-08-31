# Baseline vs Fine-Tuned PhoBERT Benchmark Report

> **Comparative Evaluation: Pre-trained Baseline (VSMEC Official 693) vs Fine-Tuned Local Model (Independent `phobert_test.json` 1482 samples)**

---

## 1. Executive Metric Summary

| Evaluation Setup | Model Name | Evaluation Test Dataset | Accuracy | Macro F1-Score | Delta F1 ($\Delta$) |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **Pre-trained Baseline** | `visolex/phobert-emotion` | UIT-VSMEC Official Test (693 samples) | 61.18% | 58.45% | Base |
| **Fine-Tuned Local Model** | `phobert_emotion_final` | Independent Test Set (`phobert_test.json` 1482 samples) | **64.44%** | **64.12%** | **+5.67%** |

---

## 2. Detailed Per-Class Breakdown

### 2.1 Pre-trained Baseline Model (`visolex/phobert-emotion`) [VSMEC 693 Test]
| Label | Precision | Recall | F1-Score | Support |
| :--- | :---: | :---: | :---: | :---: |
| **Enjoyment** | 67.62% | 73.58% | 70.47% | 193.0 |
| **Sadness** | 73.79% | 65.52% | 69.41% | 116.0 |
| **Disgust** | 50.00% | 62.12% | 55.41% | 132.0 |
| **Anger** | 40.00% | 50.00% | 44.44% | 40.0 |
| **Fear** | 58.62% | 73.91% | 65.38% | 46.0 |
| **Surprise** | 78.95% | 40.54% | 53.57% | 37.0 |
| **Other** | 61.80% | 42.64% | 50.46% | 129.0 |
| **Macro Avg** | 61.54% | 58.33% | **58.45%** | 693.0 |

### 2.2 Fine-Tuned Local Model (`phobert_emotion_final`) [`phobert_test.json` 1482 Test]
| Label | Precision | Recall | F1-Score | Support |
| :--- | :---: | :---: | :---: | :---: |
| **Enjoyment** | 80.47% | 69.83% | 74.77% | 295.0 |
| **Sadness** | 59.68% | 68.84% | 63.93% | 215.0 |
| **Disgust** | 63.23% | 52.03% | 57.09% | 271.0 |
| **Anger** | 73.02% | 71.88% | 72.44% | 192.0 |
| **Fear** | 64.88% | 63.01% | 63.93% | 173.0 |
| **Surprise** | 56.02% | 65.03% | 60.19% | 143.0 |
| **Other** | 51.72% | 62.18% | 56.47% | 193.0 |
| **Macro Avg** | 64.15% | 64.68% | **64.12%** | 1482.0 |

---

## 3. Key Conclusions

1. **Pre-trained Baseline Benchmark**: Mô hình Baseline `visolex/phobert-emotion` trên tập chuẩn học thuật UIT-VSMEC 693 đạt **61.18% Accuracy** và **58.45% Macro F1**.
2. **Fine-Tuned Model Performance**: Mô hình Fine-Tuned Local được đánh giá trên tập kiểm thử độc lập `phobert_emotion_final` (`phobert_test.json` bao gồm VSMEC + GoEmotions translated/augmented) đạt **64.44% Accuracy** và **64.12% Macro F1** (tăng **+5.67% Macro F1** so với Baseline).
