from typing import Dict, Any, List

from app.services.text_classifier import text_classifier
from app.services.emotion_detector import analyze_multiple_image_urls
from app.enums.emotion_enum import EmotionEnum


class EmotionAnalyzer:

    def analyze(self, request) -> Dict[str, Any]:

        text = request.content
        image_urls = request.imageUrls or []

        # ------------------------------------------
        # 1) TEXT EMOTION (đã normalized từ service)
        # ------------------------------------------
        text_result = text_classifier.classify_emotion(text)
        text_scores = text_result["emotion_scores"]   # { "joy": 0.82, ... }

        # ------------------------------------------
        # 2) IMAGE EMOTION (đã normalized từ service)
        # ------------------------------------------
        image_results = analyze_multiple_image_urls(image_urls)
        image_scores_avg = self._average_image_scores(image_results)

        # tổng số khuôn mặt trong toàn bộ ảnh
        total_face_count = sum(item.get("face_count", 0) for item in image_results)

        # ------------------------------------------
        # 3) Fusion
        # ------------------------------------------
        final_scores = self._fusion(
            text_scores=text_scores,
            image_scores=image_scores_avg,
            face_count=total_face_count
        )

        final_emotion = max(final_scores, key=final_scores.get)

        return {
            "text_emotion": text_result,              # gồm dominant + scores
            "image_emotions": image_results,
            "final_emotion": final_emotion,           # đã là joy / anger...
            "final_scores": final_scores
        }

    # =========================================
    # UPDATE ANALYZE SCORES
    # =========================================
    # def update_post_emotion(post_id, new_text):
    #     old = repo.get_emotion(post_id)  # load từ DB
        
    #     # 1) Analyze text again
    #     text_result = text_classifier.classify_emotion(new_text)
    #     text_scores = text_result["emotion_scores"]

    #     # 2) Lấy lại image data cũ
    #     image_scores = old["image_scores_avg"]
    #     face_count = old["face_count"]

    #     # 3) Fusion lại
    #     final_scores = post_emotion_analyzer._fusion(
    #         text_scores=text_scores,
    #         image_scores=image_scores,
    #         face_count=face_count
    #     )

    #     final_emotion = max(final_scores, key=final_scores.get)

    #     # 4) Save lại
    #     repo.update_emotion(
    #         post_id,
    #         text_emotion=text_result,
    #         final_scores=final_scores,
    #         final_emotion=final_emotion
    #     )

    #     return {
    #         "postId": post_id,
    #         "text_emotion": text_result,
    #         "image_emotions": old["image_emotions"],   # giữ nguyên
    #         "final_emotion": final_emotion,
    #         "final_scores": final_scores
    #     }


    # =========================================
    # AVERAGE IMAGE SCORES
    # =========================================
    def _average_image_scores(self, image_results: List[dict]):
        """
        Input:
        [
            {
                "dominant_emotion": "JOY",
                "emotion_scores": {
                    "JOY": 0.7, "ANGER": 0.1, ...
                }
            },
            ...
        ]
        """

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
    # FUSION TEXT + IMAGE
    # =========================================
    def _fusion(
        self,
        text_scores,
        image_scores,
        face_count: int,       # số khuôn mặt detect từ image service
        min_img_conf: float = 0.35,  # ngưỡng confidence tối thiểu
    ):
        """
        Fusion giữa text & image theo logic:
        1. Nếu không có mặt → text-only
        2. Nếu nhiều mặt → text-only
        3. Adaptive fusion theo độ tự tin (max confidence)
        """

        # ----------- 1. Face check -----------
        if face_count == 0:
            # ko dùng ảnh → trả thẳng text
            return text_scores

        if face_count > 1:
            # nhiều mặt → FER không reliable
            return text_scores

        # ----------- 2. Confirm image confidence -----------
        img_conf = max(image_scores.values())
        text_conf = max(text_scores.values())

        # Nếu ảnh quá yếu → text-only
        if img_conf < min_img_conf:
            return text_scores

        # ----------- 3. Adaptive weight -----------
        # modality nào tự tin hơn → weight lớn hơn
        w_text = text_conf / (text_conf + img_conf + 1e-6)
        w_img = img_conf / (text_conf + img_conf + 1e-6)

        # ----------- 4. Tính final score -----------
        fused = {
            e: w_text * text_scores[e] + w_img * image_scores[e]
            for e in text_scores.keys()
        }

        return fused

emotion_analyzer = EmotionAnalyzer()
