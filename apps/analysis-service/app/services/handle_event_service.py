from datetime import datetime, timezone
from app.services.emotion_analyzer import emotion_analyzer
from app.database.analysis_repository import AnalysisRepository
from app.database.models.analysis_schema import EmotionAnalysis
from app.enums.analysis_status_enum import AnalysisStatusEnum, RetryScopeEnum
from app.utils.exceptions import RetryableException

class HandleEventService:
    def __init__(self, repo: AnalysisRepository):
        self.repo = repo

    async def handle_created(self, event: dict):
        text = event["content"]
        image_urls = event.get("imageUrls", [])

        try:
            result = await emotion_analyzer.analyze(text, image_urls)

            doc = EmotionAnalysis(
                userId=event["userId"],
                targetId=event["targetId"],
                targetType=event["targetType"],
                content=text,
                imageUrls=image_urls,

                text_emotion=result.get("text_emotion"),
                image_emotions=result.get("image_emotions", []),
                final_emotion=result.get("final_emotion"),
                final_scores=result.get("final_scores"),

                status=AnalysisStatusEnum.SUCCESS
            )

        except RetryableException as e:
            doc = EmotionAnalysis(
                userId=event["userId"],
                targetId=event["targetId"],
                targetType=event["targetType"],
                content=text,
                imageUrls=image_urls,
                status=AnalysisStatusEnum.FAILED,
                retry_scope=RetryScopeEnum.FULL,
                retry_count=0,
                error_reason=str(e)
            )

        except Exception as e:
            doc = EmotionAnalysis(
                userId=event["userId"],
                targetId=event["targetId"],
                targetType=event["targetType"],
                content=text,
                imageUrls=image_urls,
                status=AnalysisStatusEnum.PERMANENT_FAILED,
                error_reason=str(e)
            )

        return await self.repo.save_analysis(doc)

    async def handle_updated(self, event: dict):

        doc = await self.repo.get_analysis_by_target(
            event["targetId"],
            event["targetType"]
        )

        if not doc:
            raise RetryableException("EmotionAnalysis not found yet")

        try:
            result = emotion_analyzer.update_emotion_analysis(doc, event["content"])

            update_payload = {
                "content": event["content"],

                "text_emotion": result.get("text_emotion"),
                "final_emotion": result.get("final_emotion"),
                "final_scores": result.get("final_scores"),

                "status": AnalysisStatusEnum.SUCCESS,
                "error_reason": None,
                "updated_at": datetime.now(timezone.utc)
            }

        except RetryableException as e:
            update_payload = {
                "content": event["content"],
                "status": AnalysisStatusEnum.FAILED,
                "retry_scope": RetryScopeEnum.TEXT_ONLY,
                "retry_count": 0,
                "error_reason": str(e),
                "updated_at": datetime.now(timezone.utc)
            }

        except Exception as e:
            update_payload = {
                "status": AnalysisStatusEnum.PERMANENT_FAILED,
                "error_reason": str(e),
                "updated_at": datetime.now(timezone.utc)
            }

        return await self.repo.update_analysis(str(doc.id), update_payload)
