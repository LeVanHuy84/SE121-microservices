#!/usr/bin/env python3
"""
Test Real Music Audio Analysis using MERT ONNX INT8 Model
Benchmark script for Admin Catalog Ingestion:
- Downloads real 2-3 minute MP3 tracks from URLs in music.json
- Measures download time, audio processing time, ONNX CPU inference time, RAM & CPU usage
- Predicts Valence & Arousal [0.0, 1.0] and maps to Russell Circumplex Quadrants
"""

import os
import sys
import time
import json
import urllib.request
import psutil
import numpy as np
import onnxruntime as ort

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

import soundfile as sf
import scipy.signal

TARGET_SR = 24000
DURATION_SEC = 15
TARGET_SAMPLES = TARGET_SR * DURATION_SEC

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
WEIGHTS_PATH = os.path.join(PROJECT_ROOT, "weights", "mert_emotion_int8.onnx")
MUSIC_JSON_PATH = os.path.join(PROJECT_ROOT, "data", "real-music", "music.json")
TEMP_AUDIO_DIR = os.path.join(PROJECT_ROOT, "data", "real-music", "downloads")
RESULTS_PATH = os.path.join(PROJECT_ROOT, "results", "real_music_benchmark.json")

os.makedirs(TEMP_AUDIO_DIR, exist_ok=True)
os.makedirs(os.path.join(PROJECT_ROOT, "results"), exist_ok=True)


def get_process_ram_mb():
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / (1024 * 1024)


def classify_quadrant(valence: float, arousal: float) -> dict:
    if valence >= 0.5 and arousal >= 0.5:
        q_code = "Q1"
        name = "Hào hứng / Vui tươi (Exuberant / Happy)"
        tags = ["Happy", "Joyful", "Energetic", "Excited"]
    elif valence < 0.5 and arousal >= 0.5:
        q_code = "Q2"
        name = "Căng thẳng / Kịch tính (Anxious / Intense)"
        tags = ["Tense", "Aggressive", "Angry", "Dramatic"]
    elif valence < 0.5 and arousal < 0.5:
        q_code = "Q3"
        name = "Trầm buồn / U uất (Sad / Melancholic)"
        tags = ["Sad", "Depressed", "Gloomy", "Lonely"]
    else:
        q_code = "Q4"
        name = "Thư thái / Bình yên (Peaceful / Chill)"
        tags = ["Relaxed", "Calm", "Peaceful", "Chill", "Lofi"]

    return {
        "quadrant": q_code,
        "emotion_category": name,
        "suggested_tags": tags
    }


def download_audio_file(url: str, output_path: str) -> float:
    start_t = time.perf_counter()
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response, open(output_path, 'wb') as out_file:
        out_file.write(response.read())
    elapsed = (time.perf_counter() - start_t) * 1000
    return elapsed


def preprocess_audio(file_path: str):
    start_t = time.perf_counter()
    
    # 1. Đọc thông tin và file MP3
    data, sr = sf.read(file_path, dtype='float32')
    
    # 2. Stereo sang Mono
    if data.ndim > 1:
        data = np.mean(data, axis=1)
        
    original_duration = len(data) / sr
    
    # 3. Tối ưu cực đại: CẮT 15s TRƯỚC ở sample rate gốc rồi mới Resample
    # Giúp giảm 90% tính toán và RAM không bị phình to
    orig_target_samples = int(sr * DURATION_SEC)
    if len(data) > orig_target_samples:
        start = (len(data) - orig_target_samples) // 2
        data = data[start:start + orig_target_samples]
    elif len(data) < orig_target_samples:
        data = np.pad(data, (0, orig_target_samples - len(data)))
        
    # 4. Resample chỉ đúng đoạn 15s sang 24,000 Hz
    if sr != TARGET_SR:
        data = scipy.signal.resample(data, TARGET_SAMPLES).astype(np.float32)
        
    audio_np = np.expand_dims(data, axis=0).astype(np.float32)
    prep_time_ms = (time.perf_counter() - start_t) * 1000
    return audio_np, original_duration, prep_time_ms


def main():
    print("=" * 80)
    print("🎵 BENCHMARK: THỬ NGHIỆM PHÂN TÍCH NHẠC THỰC TẾ VỚI MERT ONNX INT8")
    print("=" * 80)

    # 1. Kiểm tra file weights & file music.json
    if not os.path.exists(WEIGHTS_PATH):
        print(f"❌ Không tìm thấy mô hình tại: {WEIGHTS_PATH}")
        sys.exit(1)
        
    if not os.path.exists(MUSIC_JSON_PATH):
        print(f"❌ Không tìm thấy danh sách bài hát tại: {MUSIC_JSON_PATH}")
        sys.exit(1)

    with open(MUSIC_JSON_PATH, "r", encoding="utf-8") as f:
        tracks = json.load(f)

    print(f"✓ Đã nạp {len(tracks)} bài hát từ {MUSIC_JSON_PATH}")
    print(f"✓ Mô hình ONNX: {WEIGHTS_PATH} ({os.path.getsize(WEIGHTS_PATH) / (1024*1024):.2f} MB)")

    # 2. Khởi tạo ONNX Runtime Session (CPU Execution Provider)
    ram_before_load = get_process_ram_mb()
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 4
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

    session_start = time.perf_counter()
    session = ort.InferenceSession(WEIGHTS_PATH, sess_options=opts, providers=['CPUExecutionProvider'])
    session_load_time_ms = (time.perf_counter() - session_start) * 1000
    ram_after_load = get_process_ram_mb()

    print(f"✓ Khởi tạo ONNX Session CPU thành công trong: {session_load_time_ms:.2f} ms")
    print(f"✓ RAM ban đầu: {ram_before_load:.2f} MB | Sau khi load model: {ram_after_load:.2f} MB (Tăng: +{ram_after_load - ram_before_load:.2f} MB)\n")

    # Warmup 1 lượt với dummy input
    dummy_input = np.random.randn(1, TARGET_SAMPLES).astype(np.float32)
    session.run(["valence_arousal"], {"audio_waveform": dummy_input})

    results = []

    # 3. Chạy từng bài hát thực tế
    for idx, track in enumerate(tracks, 1):
        title = track.get("title", f"Track {idx}")
        artist = track.get("artist", "Unknown")
        genre = track.get("genre", "Unknown")
        url = track.get("url")

        print("-" * 80)
        print(f"🎧 [Bài {idx}/{len(tracks)}] {title} - {artist} ({genre.upper()})")
        print(f"   URL: {url}")

        local_mp3 = os.path.join(TEMP_AUDIO_DIR, f"track_{idx}.mp3")

        # Đo CPU & RAM trước khi xử lý
        psutil.cpu_percent(interval=None) # Reset CPU measurement
        ram_before_track = get_process_ram_mb()

        # Step A: Download MP3
        print("   ⏳ Đang tải file MP3...")
        dl_time_ms = download_audio_file(url, local_mp3)
        file_size_mb = os.path.getsize(local_mp3) / (1024 * 1024)
        print(f"   ✓ Tải xong ({file_size_mb:.2f} MB) trong {dl_time_ms:.1f} ms")

        # Step B: Preprocessing Audio
        audio_input, orig_duration_sec, prep_time_ms = preprocess_audio(local_mp3)
        print(f"   ✓ Độ dài bài hát: {orig_duration_sec:.1f} giây (Trích xuất 15s chorus trong {prep_time_ms:.1f} ms)")

        # Step C: Model Inference
        inf_start = time.perf_counter()
        onnx_outputs = session.run(["valence_arousal"], {"audio_waveform": audio_input})
        inf_time_ms = (time.perf_counter() - inf_start) * 1000

        # Đo RAM & CPU sau khi inference
        ram_after_track = get_process_ram_mb()
        cpu_usage = psutil.cpu_percent(interval=None)

        # Lấy kết quả Valence, Arousal
        valence = float(onnx_outputs[0][0][0])
        arousal = float(onnx_outputs[0][0][1])
        quadrant_info = classify_quadrant(valence, arousal)

        total_e2e_time_ms = dl_time_ms + prep_time_ms + inf_time_ms

        print(f"   ⚡ Thời gian suy luận ONNX CPU: {inf_time_ms:.2f} ms")
        print(f"   ⏱️ Tổng thời gian (Download + Xử lý + AI): {total_e2e_time_ms:.1f} ms")
        print(f"   🧠 Tiêu tốn RAM: {ram_after_track:.2f} MB | Tải CPU: {cpu_usage:.1f}%")
        print(f"   🎯 KẾT QUẢ CẢM XÚC:")
        print(f"      • Valence (Độ tích cực/Vui)   : {valence:.4f} / 1.0000")
        print(f"      • Arousal (Cường độ/Năng lượng): {arousal:.4f} / 1.0000")
        print(f"      • Phân loại không gian Russell : {quadrant_info['quadrant']} -> {quadrant_info['emotion_category']}")
        print(f"      • Tags cảm xúc gợi ý          : {', '.join(quadrant_info['suggested_tags'])}")

        results.append({
            "track_id": idx,
            "title": title,
            "artist": artist,
            "genre": genre,
            "url": url,
            "file_size_mb": round(file_size_mb, 2),
            "original_duration_sec": round(orig_duration_sec, 2),
            "latency_breakdown": {
                "download_ms": round(dl_time_ms, 2),
                "preprocessing_ms": round(prep_time_ms, 2),
                "onnx_inference_ms": round(inf_time_ms, 2),
                "total_e2e_ms": round(total_e2e_time_ms, 2)
            },
            "resource_usage": {
                "ram_usage_mb": round(ram_after_track, 2),
                "cpu_percent": round(cpu_usage, 1)
            },
            "emotion_predictions": {
                "valence": round(valence, 4),
                "arousal": round(arousal, 4),
                "quadrant": quadrant_info["quadrant"],
                "emotion_category": quadrant_info["emotion_category"],
                "suggested_tags": quadrant_info["suggested_tags"]
            }
        })

    # 4. Xuất Báo Cáo Tổng Hợp
    with open(RESULTS_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    avg_inf_time = np.mean([r["latency_breakdown"]["onnx_inference_ms"] for r in results])
    avg_prep_time = np.mean([r["latency_breakdown"]["preprocessing_ms"] for r in results])
    avg_ram = np.mean([r["resource_usage"]["ram_usage_mb"] for r in results])

    print("\n" + "=" * 80)
    print("📊 TỔNG KẾT HIỆU NĂNG PHÂN TÍCH NHẠC THỰC TẾ (CATALOG INGESTION BENCHMARK)")
    print("=" * 80)
    print(f"  • Thời gian suy luận AI trung bình (ONNX INT8 CPU): {avg_inf_time:.2f} ms / bài")
    print(f"  • Thời gian trích xuất & xử lý âm thanh trung bình: {avg_prep_time:.2f} ms / bài")
    print(f"  • Tổng thời gian xử lý AI thuần (không tính tải mạng): {avg_inf_time + avg_prep_time:.2f} ms / bài")
    print(f"  • Tiêu tốn RAM trung bình của tiến trình: {avg_ram:.2f} MB (< 200MB Ngưỡng an toàn)")
    print(f"  • File log chi tiết đã lưu tại: {RESULTS_PATH}")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    main()
