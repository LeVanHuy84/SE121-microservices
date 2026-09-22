#!/usr/bin/env python3
"""
Production-Ready Inference Example for Music Emotion Recognition (CPU-Only)
----------------------------------------------------------------------------
- Sử dụng ONNX Runtime INT8 chạy trên CPU.
- Xử lý file audio MP3/WAV đơn lẻ hoặc batch.
- Áp dụng cơ chế Center/Chorus Windowing 30s.
- Trả về tọa độ (Valence, Arousal) và nhãn cảm xúc 4 góc phần tư tương thích NestJS/FastAPI.
"""

import os
import sys
import logging
import numpy as np
import onnxruntime as ort
import torchaudio
import torchaudio.transforms as T
import torch
import torch.nn.functional as F

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
        opts.intra_op_num_threads = 2
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        logger.info(f"Đang khởi tạo ONNX Runtime (CPU) với mô hình: {model_path}")
        self.session = ort.InferenceSession(model_path, opts, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name

        self.target_sr = 24000
        self.target_samples = self.target_sr * 30  # 30s center-clip

    def _preprocess(self, audio_path: str) -> np.ndarray:
        waveform, sr = torchaudio.load(audio_path)

        # 1. Đổi sang Mono nếu là Stereo
        if waveform.shape[0] > 1:
            waveform = torch.mean(waveform, dim=0, keepdim=True)

        # 2. Resample sang 24,000 Hz
        if sr != self.target_sr:
            resampler = T.Resample(orig_freq=sr, new_freq=self.target_sr)
            waveform = resampler(waveform)

        # 3. Lấy 30 giây đoạn giữa bài (Chorus / Điệp khúc)
        total_samples = waveform.shape[1]
        if total_samples > self.target_samples:
            start = (total_samples - self.target_samples) // 2
            waveform = waveform[:, start:start + self.target_samples]
        elif total_samples < self.target_samples:
            padding = self.target_samples - total_samples
            waveform = F.pad(waveform, (0, padding))

        return waveform.numpy().astype(np.float32)

    def predict(self, audio_path: str) -> dict:
        """Dự đoán cảm xúc cho 1 file audio."""
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Không tìm thấy file audio: {audio_path}")

        waveform_np = self._preprocess(audio_path)
        outputs = self.session.run(None, {self.input_name: waveform_np})
        valence, arousal = outputs[0][0]

        v = float(np.clip(valence, 0.0, 1.0))
        a = float(np.clip(arousal, 0.0, 1.0))

        # Phân loại góc phần tư cảm xúc
        if v >= 0.5 and a >= 0.5:
            mood = "Joy / Excited (Vui tươi, Năng động)"
        elif v < 0.5 and a >= 0.5:
            mood = "Angry / Stress (Căng thẳng, Giận dữ)"
        elif v < 0.5 and a < 0.5:
            mood = "Sad / Depressed (U sầu, Buồn bã)"
        else:
            mood = "Calm / Relaxed (Thư thái, Bình yên)"

        return {
            "valence": round(v, 4),
            "arousal": round(a, 4),
            "dominant_mood": mood,
            "file": os.path.basename(audio_path)
        }


def main():
    print("\n=== DEMO INFERENCE MUSIC EMOTION (CPU ONLY) ===")
    if len(sys.argv) > 1:
        audio_path = sys.argv[1]
    else:
        print("Sử dụng: python inference_example.py <path_to_audio.mp3>")
        return

    try:
        predictor = MusicEmotionPredictor()
        result = predictor.predict(audio_path)
        print("\n" + "=" * 40)
        print("          KẾT QUẢ PHÂN TÍCH")
        print("=" * 40)
        print(f"File         : {result['file']}")
        print(f"Valence (0-1): {result['valence']}")
        print(f"Arousal (0-1): {result['arousal']}")
        print(f"Mood         : {result['dominant_mood']}")
        print("=" * 40 + "\n")
    except Exception as e:
        logger.error(f"Lỗi inference: {e}")


if __name__ == "__main__":
    main()
