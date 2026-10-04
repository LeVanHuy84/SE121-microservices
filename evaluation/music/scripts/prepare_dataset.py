#!/usr/bin/env python3
"""
Dataset Preparation & Multi-Dataset Fusion Script for Music Emotion Recognition (MER)
-------------------------------------------------------------------------------------
- Nạp dữ liệu từ thư mục raw/:
  1. DEAM: 1,802 bài hát (MEMD_audio + static annotations).
  2. PMEmo: 767 bài hát (chorus audio + static annotations).
- Kiểm tra toàn vẹn (Audio Integrity Check): Chỉ giữ các bài có file audio MP3 thực tế.
- Đồng bộ công thức chuẩn hóa nhãn về không gian [0.0, 1.0].
- Tạo thư mục audio đồng nhất với prefix tránh trùng tên: `deam_{id}.mp3` và `pmemo_{id}.mp3`.
- Phân tầng theo 4 góc phần tư cảm xúc (Stratified 4-Quadrant Splitting).
- Chia tập theo chuẩn Khoa học Máy tính: 70% Train, 15% Validation, 15% Held-Out Test.
- Xuất các file CSV: train.csv, val.csv, test.csv và metadata dataset_summary.json.
"""

import os
import shutil
import json
import logging
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")
RAW_DIR = os.path.join(DATA_DIR, "raw")
SPLITS_DIR = os.path.join(DATA_DIR, "splits")
UNIFIED_AUDIO_DIR = os.path.join(DATA_DIR, "audio")

os.makedirs(SPLITS_DIR, exist_ok=True)
os.makedirs(UNIFIED_AUDIO_DIR, exist_ok=True)


def get_quadrant(v: float, a: float) -> str:
    """Xác định góc phần tư cảm xúc theo Russell's Circumplex Model."""
    if v >= 0.5 and a >= 0.5:
        return "Q1_Joy_Excited"
    elif v < 0.5 and a >= 0.5:
        return "Q2_Angry_Stress"
    elif v < 0.5 and a < 0.5:
        return "Q3_Sad_Depressed"
    else:
        return "Q4_Calm_Relaxed"


def process_deam():
    """Nạp và kiểm tra dữ liệu DEAM."""
    anno1 = os.path.join(RAW_DIR, "DEAM", "annotations", "annotations averaged per song", "song_level", "static_annotations_averaged_songs_1_2000.csv")
    anno2 = os.path.join(RAW_DIR, "DEAM", "annotations", "annotations averaged per song", "song_level", "static_annotations_averaged_songs_2000_2058.csv")
    audio_dir = os.path.join(RAW_DIR, "DEAM", "MEMD_audio")

    if not os.path.exists(anno1) or not os.path.exists(audio_dir):
        logger.warning(f"Không tìm thấy thư mục DEAM tại: {RAW_DIR}/DEAM")
        return pd.DataFrame()

    df1 = pd.read_csv(anno1, encoding="utf-8-sig")
    df2 = pd.read_csv(anno2, encoding="utf-8-sig") if os.path.exists(anno2) else pd.DataFrame()
    df = pd.concat([df1, df2], ignore_index=True)
    df.columns = df.columns.str.strip()

    available_audios = set(os.listdir(audio_dir))
    records = []

    for _, row in df.iterrows():
        song_id = int(row["song_id"])
        orig_filename = f"{song_id}.mp3"
        if orig_filename not in available_audios:
            continue

        unified_filename = f"deam_{song_id}.mp3"
        src_path = os.path.join(audio_dir, orig_filename)
        dst_path = os.path.join(UNIFIED_AUDIO_DIR, unified_filename)

        # Copy sang thư mục unified_audio nếu chưa có
        if not os.path.exists(dst_path):
            shutil.copy2(src_path, dst_path)

        # Chuẩn hóa nhãn từ thang 1.0 - 9.0 về [0.0, 1.0]
        v_norm = float(np.clip((row["valence_mean"] - 1.0) / 8.0, 0.0, 1.0))
        a_norm = float(np.clip((row["arousal_mean"] - 1.0) / 8.0, 0.0, 1.0))

        records.append({
            "track_id": f"deam_{song_id}",
            "raw_id": str(song_id),
            "source_dataset": "DEAM",
            "audio_filename": unified_filename,
            "valence": round(v_norm, 4),
            "arousal": round(a_norm, 4),
        })

    result_df = pd.DataFrame(records)
    logger.info(f"✓ Đã xử lý DEAM: {len(result_df)} bài hát khớp audio.")
    return result_df


def process_pmemo():
    """Nạp và kiểm tra dữ liệu PMEmo."""
    anno_file = os.path.join(RAW_DIR, "PMEmo2019", "annotations", "static_annotations.csv")
    audio_dir = os.path.join(RAW_DIR, "PMEmo2019", "chorus")

    if not os.path.exists(anno_file) or not os.path.exists(audio_dir):
        logger.warning(f"Không tìm thấy thư mục PMEmo tại: {RAW_DIR}/PMEmo2019")
        return pd.DataFrame()

    df = pd.read_csv(anno_file, encoding="utf-8-sig")
    df.columns = df.columns.str.strip()

    available_audios = set(os.listdir(audio_dir))
    records = []

    for _, row in df.iterrows():
        music_id = int(row["musicId"])
        orig_filename = f"{music_id}.mp3"
        if orig_filename not in available_audios:
            continue

        unified_filename = f"pmemo_{music_id}.mp3"
        src_path = os.path.join(audio_dir, orig_filename)
        dst_path = os.path.join(UNIFIED_AUDIO_DIR, unified_filename)

        # Copy sang thư mục unified_audio nếu chưa có
        if not os.path.exists(dst_path):
            shutil.copy2(src_path, dst_path)

        # PMEmo nhãn Arousal(mean) và Valence(mean) đã ở thang [0.0, 1.0]
        v_norm = float(np.clip(row["Valence(mean)"], 0.0, 1.0))
        a_norm = float(np.clip(row["Arousal(mean)"], 0.0, 1.0))

        records.append({
            "track_id": f"pmemo_{music_id}",
            "raw_id": str(music_id),
            "source_dataset": "PMEmo",
            "audio_filename": unified_filename,
            "valence": round(v_norm, 4),
            "arousal": round(a_norm, 4),
        })

    result_df = pd.DataFrame(records)
    logger.info(f"✓ Đã xử lý PMEmo: {len(result_df)} bài hát khớp audio.")
    return result_df


def main():
    logger.info("=== BẮT ĐẦU CHUẨN BỊ VÀ HỢP NHẤT DỮ LIỆU DEAM + PMEMO (70/15/15 SPLIT) ===")

    # 1. Xử lý từng bộ dữ liệu
    df_deam = process_deam()
    df_pmemo = process_pmemo()

    if df_deam.empty and df_pmemo.empty:
        raise FileNotFoundError(f"Không tìm thấy dữ liệu raw trong {RAW_DIR}!")

    # 2. Hợp nhất (Fusion)
    full_df = pd.concat([df_deam, df_pmemo], ignore_index=True)
    full_df = full_df.drop_duplicates(subset=["track_id"]).reset_index(drop=True)

    # 3. Gán nhãn 4 góc phần tư cảm xúc (4-Quadrant)
    full_df["quadrant"] = [get_quadrant(v, a) for v, a in zip(full_df["valence"], full_df["arousal"])]

    logger.info("\n=== THỐNG KÊ PHÂN BỐ CẢM XÚC HỢP NHẤT (QUADRANTS) ===")
    quad_counts = full_df["quadrant"].value_counts()
    for q, count in quad_counts.items():
        pct = (count / len(full_df)) * 100
        logger.info(f"  • {q:20s}: {count:5d} bài ({pct:5.2f}%)")

    # 4. Phân chia tập dữ liệu theo chuẩn CS: 70% Train, 15% Val, 15% Test (Stratified)
    train_df, temp_df = train_test_split(
        full_df,
        test_size=0.30,  # 30% cho Val + Test
        random_state=42,
        stratify=full_df["quadrant"]
    )

    val_df, test_df = train_test_split(
        temp_df,
        test_size=0.50,  # Chia đôi 30% thành 15% Val và 15% Test
        random_state=42,
        stratify=temp_df["quadrant"]
    )

    # 5. Lưu CSV
    train_path = os.path.join(SPLITS_DIR, "train.csv")
    val_path = os.path.join(SPLITS_DIR, "val.csv")
    test_path = os.path.join(SPLITS_DIR, "test.csv")

    train_df.to_csv(train_path, index=False)
    val_df.to_csv(val_path, index=False)
    test_df.to_csv(test_path, index=False)

    # 6. Xuất metadata tổng hợp
    summary = {
        "split_ratio": "70% Train / 15% Val / 15% Test",
        "total_samples": len(full_df),
        "train_samples": len(train_df),
        "val_samples": len(val_df),
        "test_samples": len(test_df),
        "dataset_breakdown": full_df["source_dataset"].value_counts().to_dict(),
        "quadrant_distribution": {
            q: {
                "total": int(count),
                "train": int((train_df["quadrant"] == q).sum()),
                "val": int((val_df["quadrant"] == q).sum()),
                "test": int((test_df["quadrant"] == q).sum()),
            }
            for q, count in quad_counts.items()
        },
        "stats": {
            "valence_mean": float(full_df["valence"].mean()),
            "valence_std": float(full_df["valence"].std()),
            "arousal_mean": float(full_df["arousal"].mean()),
            "arousal_std": float(full_df["arousal"].std()),
        }
    }

    summary_path = os.path.join(SPLITS_DIR, "dataset_summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    logger.info("\n=== KẾT QUẢ TỔNG HỢP HỢP NHẤT (70 / 15 / 15 SPLIT) ===")
    logger.info(f"  • Tổng bài hát hợp nhất : {len(full_df)} bài MP3 (DEAM: {len(df_deam)}, PMEmo: {len(df_pmemo)})")
    logger.info(f"  • Train set (70%)       : {len(train_df)} bài -> {train_path}")
    logger.info(f"  • Val set   (15%)       : {len(val_df)} bài -> {val_path}")
    logger.info(f"  • Test set  (15%)       : {len(test_df)} bài -> {test_path}")
    logger.info(f"  • Thư mục unified audio : {UNIFIED_AUDIO_DIR}")
    logger.info(f"  • Metadata summary      : {summary_path}")
    logger.info("✓ HOÀN TẤT CHUẨN BỊ TOÀN BỘ DỮ LIỆU THÀNH CÔNG!\n")


if __name__ == "__main__":
    main()
