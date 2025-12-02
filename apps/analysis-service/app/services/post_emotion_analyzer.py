from typing import Dict, Any
from app.services.model_loader import model_loader
from app.services.emotion_detector import analyze_multiple_image_urls
from app.enums.emotion_type import Emotion
import numpy as np

class PostEmotionAnalyzer:

    def analyze(self, text: str, image_urls: list[str]) -> Dict[str, Any]:
        
        # 1. TEXT EMOTION
        text_result = model_loader.emotion_pipeline(text)[0]
        text_scores = self._convert_text_to_scores(text_result)

        # 2. IMAGE EMOTION
        image_results = analyze_multiple_image_urls(image_urls)
        image_scores_avg = self._average_image_scores(image_results)

        # 3. Fusion
        final_scores = self._fusion(text_scores, image_scores_avg)
        final_emotion = max(final_scores, key=final_scores.get)

        return {
            "text_emotion": text_scores,
            "image_emotions": image_results,
            "final_emotion": final_emotion,
            "final_scores": final_scores
        }

    def _convert_text_to_scores(self, text_res):
        # map lại label của PhoBERT -> 7 emotion chuẩn FER
        base = {e: 0.0 for e in self.EMOTIONS}
        label = text_res["label"].lower()

        # Ví dụ mapping (bạn có thể chỉnh tuỳ model)
        mapping = {
            "joy": "happy",
            "anger": "angry",
            "sadness": "sad",
            "fear": "fear",
            "surprise": "surprise",
            "neutral": "neutral",
            "disgust": "disgust"
        }

        if label in mapping:
            base[mapping[label]] = text_res["score"]

        return base

    def _average_image_scores(self, image_results):
        if not image_results:
            return {e: 0.0 for e in self.EMOTIONS}

        sums = {e: 0.0 for e in self.EMOTIONS}
        count = 0

        for item in image_results:
            scores = item.get("emotion_scores")
            if not scores:
                continue
            for e in self.EMOTIONS:
                sums[e] += scores.get(e, 0)
            count += 1

        if count == 0:
            return sums  

        return {e: sums[e] / count for e in self.EMOTIONS}

    def _fusion(self, text_scores, image_scores, w_text=0.6, w_img=0.4):
        return {
            e: w_text * text_scores[e] + w_img * image_scores[e]
            for e in self.EMOTIONS
        }


post_emotion_analyzer = PostEmotionAnalyzer()
