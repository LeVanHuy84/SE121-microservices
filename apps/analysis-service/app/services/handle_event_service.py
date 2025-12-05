from app.services.emotion_analyzer import emotion_analyzer
from app.database.analysis_repository import AnalysisRepository
from app.database.models.analysis_schema import EmotionAnalysis

class HandleEventService:
    def __init__(self, repo: AnalysisRepository):
        self.repo = repo

    async def handle_created(self, event: dict):
        """
        event = {
            "userId": "...",
            "targetId": "...",
            "targetType": "...",
            "content": "...",
            "imageUrls": ["..."]
        }
        """

        text = event["content"]
        image_urls = event.get("imageUrls", [])

        result = await emotion_analyzer.analyze(text, image_urls)

        doc = EmotionAnalysis(
            userId=event["userId"],
            targetId=event["targetId"],
            targetType=event["targetType"],
            text_emotion=result["text_emotion"],
            image_emotions=result["image_emotions"],
            final_emotion=result["final_emotion"],
            final_scores=result["final_scores"]
        )

        await self.repo.save_analysis(doc)
        return doc

    async def handle_updated(self, event: dict):
        """
        event = { userId, targetId, targetType, content }
        """

        emotion_analysis = await self.repo.get_analysis_by_target(
            event["targetId"], event["targetType"]
        )

        result = emotion_analyzer.update_emotion_analysis(emotion_analysis, event["content"])

        update_payload = {
            "text_emotion": result["text_emotion"],
            "final_emotion": result["final_emotion"],
            "final_scores": result["final_scores"]
        }

        return await self.repo.update_analysis(event["targetId"], update_payload)
