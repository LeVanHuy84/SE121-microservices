from typing import Dict, Any, List

from app.services.text_classifier import text_classifier
from app.services.emotion_detector import analyze_multiple_image_urls
from app.enums.emotion_enum import EmotionEnum
from app.utils.exceptions import RetryableException
from app.database.models.analysis_schema import EmotionAnalysis


class EmotionAnalyzer:

    # =========================================
    # ANALYZE EMOTION (ASYNC)
    # =========================================
    async def analyze(self, text: str, image_urls: List[str]) -> Dict[str, Any]:

        # Text classifier vẫn sync → giữ nguyên
        text_result = text_classifier.classify_emotion(text)
        text_scores = text_result["emotionScores"]

        # Image FER là async → phải await
        image_results = await analyze_multiple_image_urls(image_urls)

        if not image_results:
            image_results = []

        retryable_errors = [x for x in image_results if x.get("error") and x.get("retryable")]

        total = len(image_results)

        retry_ratio = len(retryable_errors) / total if total > 0 else 0

        if retry_ratio >= 0.4:
            raise RetryableException(f"Retryable ratio too high: {retry_ratio}")

        image_scores_avg = self._average_image_scores(image_results)

        total_face_count = sum(item.get("faceCount", 0) for item in image_results)

        final_scores = self._fusion(
            text_scores=text_scores,
            image_scores=image_scores_avg,
            face_count=total_face_count
        )

        final_emotion = max(final_scores, key=final_scores.get)

        return {
            "textEmotion": text_result,
            "imageEmotions": image_results,
            "finalEmotion": final_emotion,
            "finalScores": final_scores
        }

    # =========================================
    # UPDATE EMOTION ANALYSIS (ASYNC)
    # =========================================
    def update_emotion_analysis(self, emotion_analysis: EmotionAnalysis, new_text: str):

        text_result = text_classifier.classify_emotion(new_text)
        text_scores = text_result["emotionScores"]

        image_emotions = emotion_analysis.imageEmotions or []

        image_scores_avg = self._average_image_scores(image_emotions)
        total_face_count = sum(item.get("faceCount", 0) for item in image_emotions)

        final_scores = self._fusion(
            text_scores=text_scores,
            image_scores=image_scores_avg,
            face_count=total_face_count
        )

        final_emotion = max(final_scores, key=final_scores.get)

        return {
            "textEmotion": text_result,
            "imageEmotions": image_emotions,
            "finalEmotion": final_emotion,
            "finalScores": final_scores
        }

    # =========================================
    # AVERAGE IMAGE SCORES (SYNC)
    # =========================================
    def _average_image_scores(self, image_results: List[dict]):
        try:
            base = {e.value: 0.0 for e in EmotionEnum}
            count = 0

            for item in image_results or []:
                scores = item.get("emotionScores")
                if not scores:
                    continue

                for e in EmotionEnum:
                    base[e.value] += scores.get(e.value, 0.0)
                count += 1

            if count == 0:
                return base

            return {e.value: base[e.value] / count for e in EmotionEnum}

        except Exception as e:
            return {e.value: 0.0 for e in EmotionEnum}

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
        if not image_scores:
            return text_scores

        if face_count == 0:
            return text_scores

        try:
            img_conf = max(image_scores.values())
            text_conf = max(text_scores.values())
        except Exception:
            return text_scores

        if img_conf < min_img_conf:
            return text_scores

        w_text = text_conf / (text_conf + img_conf + 1e-6)
        w_img = img_conf / (text_conf + img_conf + 1e-6)

        fused = {
            e: w_text * text_scores[e] + w_img * image_scores.get(e, 0.0)
            for e in text_scores.keys()
        }

        return fused


emotion_analyzer = EmotionAnalyzer()
