# PhoBERT Evaluation & Teencode Normalization Pipeline Report

> **Teencode & Slang Stress Test Evaluation: Assessing Preprocessor Pipeline (`teencode_normalizer`) Impact**

---

## 1. Overall Teencode Pipeline Evaluation Summary

| Input Preprocessing State | Model Variant | Accuracy | Macro F1-Score | Delta F1 ($\Delta$) |
| :--- | :--- | :---: | :---: | :---: |
| **Raw Input (No Preprocessing)** | Baseline (`visolex/phobert-emotion`) | 68.00% | 68.74% | Base |
| **Raw Input (No Preprocessing)** | Fine-Tuned Model (`phobert_emotion_final`) | 81.00% | 80.75% | +12.01% |
| **Normalized Pipeline (`teencode_normalizer`)** | **Fine-Tuned Model (`phobert_emotion_final`)** | **82.00%** | **81.58%** | **+0.83% vs Raw** |

---

## 2. Detailed Per-Class Breakdown (Teencode Stress Test - 300 Noise Samples)

### 2.1 Baseline Model (`visolex/phobert-emotion`) [Raw Input]
| Label | Precision | Recall | F1-Score | Support |
| :--- | :---: | :---: | :---: | :---: |
| **Enjoyment** | 37.61% | 95.35% | 53.95% | 43.0 |
| **Sadness** | 80.95% | 79.07% | 80.00% | 43.0 |
| **Disgust** | 75.00% | 76.74% | 75.86% | 43.0 |
| **Anger** | 100.00% | 44.19% | 61.29% | 43.0 |
| **Fear** | 81.40% | 81.40% | 81.40% | 43.0 |
| **Surprise** | 96.43% | 62.79% | 76.06% | 43.0 |
| **Other** | 100.00% | 35.71% | 52.63% | 42.0 |
| **Macro Avg** | 81.63% | 67.89% | **68.74%** | 300.0 |

### 2.2 Fine-Tuned Model (`phobert_emotion_final`) [Raw Input]
| Label | Precision | Recall | F1-Score | Support |
| :--- | :---: | :---: | :---: | :---: |
| **Enjoyment** | 65.08% | 95.35% | 77.36% | 43.0 |
| **Sadness** | 82.00% | 95.35% | 88.17% | 43.0 |
| **Disgust** | 87.88% | 67.44% | 76.32% | 43.0 |
| **Anger** | 80.65% | 58.14% | 67.57% | 43.0 |
| **Fear** | 85.71% | 83.72% | 84.71% | 43.0 |
| **Surprise** | 92.11% | 81.40% | 86.42% | 43.0 |
| **Other** | 83.72% | 85.71% | 84.71% | 42.0 |
| **Macro Avg** | 82.45% | 81.02% | **80.75%** | 300.0 |

### 2.3 Fine-Tuned Model + Teencode Preprocessing Pipeline (`teencode_normalizer`)
| Label | Precision | Recall | F1-Score | Support |
| :--- | :---: | :---: | :---: | :---: |
| **Enjoyment** | 80.85% | 88.37% | 84.44% | 43.0 |
| **Sadness** | 80.77% | 97.67% | 88.42% | 43.0 |
| **Disgust** | 80.00% | 65.12% | 71.79% | 43.0 |
| **Anger** | 70.27% | 60.47% | 65.00% | 43.0 |
| **Fear** | 85.11% | 93.02% | 88.89% | 43.0 |
| **Surprise** | 85.71% | 83.72% | 84.71% | 43.0 |
| **Other** | 90.00% | 85.71% | 87.80% | 42.0 |
| **Macro Avg** | 81.82% | 82.01% | **81.58%** | 300.0 |

---

## 3. Key Findings & Conclusions

1. **Teencode Noise Impact**: Dữ liệu mạng xã hội chứa teencode/từ lóng làm giảm hiệu năng của mô hình Baseline. Quá trình Fine-Tuning nâng F1-Score từ **68.74%** lên **80.75%**.
2. **Preprocessor Pipeline Gain**: Khi cho câu đi qua **Teencode Normalization Pipeline** (`teencode_normalizer`), chỉ số Macro F1 tăng thêm **+0.83%**, đạt mốc tối ưu **81.58%** và Accuracy đạt **82.00%**.
