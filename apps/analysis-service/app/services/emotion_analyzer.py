from typing import Dict, Any, List

from app.services.text_classifier import text_classifier
from app.services.emotion_detector import analyze_multiple_image_urls
from app.enums.emotion_enum import EmotionEnum


class EmotionAnalyzer:

    # =========================================
    # ANALYZE EMOTION (ASYNC)
    # =========================================
    async def analyze(self, text: str, image_urls: List[str]) -> Dict[str, Any]:

        # Text classifier vẫn sync → giữ nguyên
        text_result = text_classifier.classify_emotion(text)
        text_scores = text_result["emotion_scores"]

        # Image FER là async → phải await
        image_results = await analyze_multiple_image_urls(image_urls)
        image_scores_avg = self._average_image_scores(image_results)

        total_face_count = sum(item.get("face_count", 0) for item in image_results)

        final_scores = self._fusion(
            text_scores=text_scores,
            image_scores=image_scores_avg,
            face_count=total_face_count
        )

        final_emotion = max(final_scores, key=final_scores.get)

        return {
            "text_emotion": text_result,
            "image_emotions": image_results,
            "final_emotion": final_emotion,
            "final_scores": final_scores
        }

    # =========================================
    # UPDATE EMOTION ANALYSIS (ASYNC)
    # =========================================
    def update_emotion_analysis(self, emotion_analysis, new_text):

        text_result = text_classifier.classify_emotion(new_text)
        text_scores = text_result["emotion_scores"]

        # image_emotions lấy từ DB → vẫn sync
        image_emotions = emotion_analysis["image_emotions"]

        image_scores_avg = self._average_image_scores(image_emotions)
        total_face_count = sum(item.get("face_count", 0) for item in image_emotions)

        final_scores = self._fusion(
            text_scores=text_scores,
            image_scores=image_scores_avg,
            face_count=total_face_count
        )

        final_emotion = max(final_scores, key=final_scores.get)

        return {
            "text_emotion": text_result,
            "image_emotions": image_emotions,
            "final_emotion": final_emotion,
            "final_scores": final_scores
        }

    # =========================================
    # AVERAGE IMAGE SCORES (SYNC)
    # =========================================
    def _average_image_scores(self, image_results: List[dict]):
        base = {e.value: 0.0 for e in EmotionEnum}
        count = 0

        for item in image_results:
            scores = item.get("emotion_scores")
            if not scores:
                continue

            for e in EmotionEnum:
                base[e.value] += scores.get(e.value, 0.0)

            count += 1

        if count == 0:
            return base

        return {e.value: base[e.value] / count for e in EmotionEnum}

    # =========================================
    # FUSION TEXT + IMAGE (SYNC)
    # =========================================
    def _fusion(
        self,
        text_scores,
        image_scores,
        face_count: int,
        min_img_conf: float = 0.35,
    ):
        if face_count == 0:
            return text_scores

        if face_count > 1:
            return text_scores

        img_conf = max(image_scores.values())
        text_conf = max(text_scores.values())

        if img_conf < min_img_conf:
            return text_scores

        w_text = text_conf / (text_conf + img_conf + 1e-6)
        w_img = img_conf / (text_conf + img_conf + 1e-6)

        fused = {
            e: w_text * text_scores[e] + w_img * image_scores[e]
            for e in text_scores.keys()
        }

        return fused


emotion_analyzer = EmotionAnalyzer()
