import os
import sys
import time
import logging
import tempfile
import urllib.request
import numpy as np
import onnxruntime as ort
import soundfile as sf
import scipy.signal

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL_PATH = os.path.join(BASE_DIR, "..", "weights", "mert_emotion_int8.onnx")


class MusicEmotionPredictor:
    def __init__(self, model_path: str = DEFAULT_MODEL_PATH):
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Chưa tìm thấy file mô hình tại: {model_path}!\n"
                f"Vui lòng chạy notebook trên Colab và tải file mert_emotion_int8.onnx về thư mục weights/."
            )

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 4
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        logger.info(f"Đang khởi tạo ONNX Runtime (CPU) với mô hình: {model_path}")
        self.session = ort.InferenceSession(model_path, opts, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name

        self.target_sr = 24000
        self.duration_sec = 15  # 15s center-clip for fast & accurate inference
        self.target_samples = self.target_sr * self.duration_sec

    def _preprocess(self, audio_path: str):
        prep_start = time.perf_counter()
        data, sr = sf.read(audio_path, dtype="float32")

        # 1. Đổi sang Mono nếu là Stereo
        if data.ndim > 1:
            data = np.mean(data, axis=1)

        orig_duration = len(data) / sr

        # 2. Cắt đoạn giữa trước khi resample
        orig_target_samples = int(sr * self.duration_sec)
        if len(data) > orig_target_samples:
            start = (len(data) - orig_target_samples) // 2
            data = data[start:start + orig_target_samples]
        elif len(data) < orig_target_samples:
            data = np.pad(data, (0, orig_target_samples - len(data)))

        # 3. Resample sang 24,000 Hz
        if sr != self.target_sr:
            data = scipy.signal.resample(data, self.target_samples).astype(np.float32)

        waveform = np.expand_dims(data, axis=0).astype(np.float32)
        prep_time_ms = (time.perf_counter() - prep_start) * 1000
        return waveform, orig_duration, prep_time_ms

    def predict(self, audio_source: str) -> dict:
        """Dự đoán cảm xúc cho 1 file audio hoặc URL."""
        is_url = audio_source.startswith("http://") or audio_source.startswith("https://")
        temp_file_to_clean = None
        dl_time_ms = 0.0

        if is_url:
            logger.info("Đang tải file audio từ URL...")
            dl_start = time.perf_counter()
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
            req = urllib.request.Request(audio_source, headers=headers)
            
            suffix = ".mp3"
            parsed_name = audio_source.split("?")[0].split("/")[-1]
            if "." in parsed_name:
                ext = "." + parsed_name.split(".")[-1]
                if ext in [".mp3", ".wav", ".ogg", ".flac", ".m4a"]:
                    suffix = ext

            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                temp_file_to_clean = tmp.name
                with urllib.request.urlopen(req, timeout=30) as response:
                    tmp.write(response.read())

            dl_time_ms = (time.perf_counter() - dl_start) * 1000
            audio_path = temp_file_to_clean
            file_size_mb = os.path.getsize(audio_path) / (1024 * 1024)
            logger.info(f"✓ Đã tải xong ({file_size_mb:.2f} MB) trong {dl_time_ms:.1f} ms")
        else:
            audio_path = audio_source
            if not os.path.exists(audio_path):
                raise FileNotFoundError(f"Không tìm thấy file audio: {audio_path}")

        try:
            waveform_np, orig_duration, prep_time_ms = self._preprocess(audio_path)

            inf_start = time.perf_counter()
            outputs = self.session.run(None, {self.input_name: waveform_np})
            inf_time_ms = (time.perf_counter() - inf_start) * 1000

            valence, arousal = outputs[0][0]
            v = float(np.clip(valence, 0.0, 1.0))
            a = float(np.clip(arousal, 0.0, 1.0))

            # Phân loại góc phần tư cảm xúc (Russell Circumplex)
            if v >= 0.5 and a >= 0.5:
                mood = "Q1: Joy / Excited (Vui tươi, Hào hứng)"
            elif v < 0.5 and a >= 0.5:
                mood = "Q2: Angry / Stress (Căng thẳng, Kịch tính)"
            elif v < 0.5 and a < 0.5:
                mood = "Q3: Sad / Depressed (U sầu, Trầm buồn)"
            else:
                mood = "Q4: Calm / Relaxed (Thư thái, Bình yên)"

            total_analysis_ms = prep_time_ms + inf_time_ms
            total_e2e_ms = dl_time_ms + total_analysis_ms

            display_name = audio_source.split("?")[0].split("/")[-1] if is_url else os.path.basename(audio_path)

            return {
                "file": display_name,
                "source": audio_source,
                "duration_sec": round(orig_duration, 2),
                "valence": round(v, 4),
                "arousal": round(a, 4),
                "dominant_mood": mood,
                "timing": {
                    "download_ms": round(dl_time_ms, 1),
                    "prep_ms": round(prep_time_ms, 1),
                    "inference_ms": round(inf_time_ms, 1),
                    "total_analysis_ms": round(total_analysis_ms, 1),
                    "total_e2e_ms": round(total_e2e_ms, 1),
                }
            }
        finally:
            if temp_file_to_clean and os.path.exists(temp_file_to_clean):
                try:
                    os.remove(temp_file_to_clean)
                except Exception:
                    pass


def main():
    print("\n=== DEMO INFERENCE MUSIC EMOTION (CPU ONLY) ===")
    
    if len(sys.argv) > 1:
        audio_source = sys.argv[1]
    else:
        try:
            audio_source = input("🎧 Nhập URL hoặc đường dẫn file audio: ").strip().strip('"').strip("'")
        except (EOFError, KeyboardInterrupt):
            print("\nĐã hủy.")
            return

    if not audio_source:
        print("Sử dụng: python inference_example.py <url_hoặc_path_to_audio.mp3>")
        return

    try:
        predictor = MusicEmotionPredictor()
        result = predictor.predict(audio_source)
        t = result["timing"]

        print("\n" + "=" * 60)
        print("                 KẾT QUẢ PHÂN TÍCH")
        print("=" * 60)
        print(f"• File / Nguồn      : {result['file']}")
        print(f"• Thời lượng gốc    : {result['duration_sec']}s")
        print(f"• Valence [0.0-1.0] : {result['valence']}")
        print(f"• Arousal [0.0-1.0] : {result['arousal']}")
        print(f"• Tâm trạng (Mood)  : {result['dominant_mood']}")
        print("-" * 60)
        print("⏱️ THỜI GIAN THỰC THI:")
        print(f"  - Download time   : {t['download_ms']} ms ({t['download_ms']/1000:.2f}s)")
        print(f"  - Preprocessing   : {t['prep_ms']} ms")
        print(f"  - AI Inference    : {t['inference_ms']} ms ({t['inference_ms']/1000:.2f}s)")
        print(f"  - Tổng phân tích  : {t['total_analysis_ms']} ms ({t['total_analysis_ms']/1000:.2f}s)")
        print(f"  - Tổng E2E        : {t['total_e2e_ms']} ms ({t['total_e2e_ms']/1000:.2f}s)")
        print("=" * 60 + "\n")
    except Exception as e:
        logger.error(f"Lỗi inference: {e}")


if __name__ == "__main__":
    main()
