from app.database.analysis_repository import AnalysisRepository
from app.database.outbox_repository import OutboxRepository
import asyncio
from app.enums.analysis_status_enum import AnalysisStatusEnum
from app.services.emotion_analyzer import EmotionAnalyzer
from app.database.models.outbox_schema import Outbox
from app.enums.analysis_status_enum import RetryScopeEnum
from datetime import datetime, timezone


class RetryWorker:

    MAX_RETRY = 2

    def __init__(self, repo: AnalysisRepository, outbox_repo: OutboxRepository):
        self.repo = repo
        self.outbox_repo = outbox_repo
        self.analyzer = EmotionAnalyzer()
        self._running = True

    def stop(self):
        self._running = False

    async def start(self):
        while self._running:
            try:
                await self.process_failed()
            except Exception as e:
                print("[RetryWorker] LOOP ERROR:", str(e))

            await asyncio.sleep(60)


    async def process_failed(self):
        docs = await self.repo.find_failed(max_retry=self.MAX_RETRY)

        for doc in docs:
            scope = doc.retry_scope or RetryScopeEnum.FULL

            try:
                print(f"[RetryWorker] Retrying: {doc.id} | scope={scope}")

                # ===============================
                # 1. CHỌN CÁCH ANALYZE
                # ===============================
                if scope == RetryScopeEnum.TEXT_ONLY:
                    result = self.analyzer.update_emotion_analysis(
                        emotion_analysis=doc,
                        new_text=doc.content,
                    )
                    outbox_event_type = "ANALYSIS_UPDATED"
                else:
                    result = await self.analyzer.analyze(
                        text=doc.content,
                        image_urls=doc.imageUrls or [],
                    )
                    outbox_event_type = "ANALYSIS_CREATED"

                # ===============================
                # 2. UPDATE DB (SUCCESS)
                # ===============================
                await self.repo.update_analysis(doc.id, {
                    "text_emotion": result["text_emotion"],
                    "image_emotions": result["image_emotions"],
                    "final_emotion": result["final_emotion"],
                    "final_scores": result["final_scores"],
                    "status": AnalysisStatusEnum.SUCCESS,
                    "retry_count": doc.retry_count + 1,
                    "retry_scope": None,
                    "error_reason": None,
                    "updated_at": datetime.now(timezone.utc),
                })

                # ===============================
                # 3. SAVE OUTBOX
                # ===============================
                await self.outbox_repo.save_outbox(
                    Outbox(
                        topic="analysis-result-events",
                        event_type=outbox_event_type,
                        payload={
                            "targetId": str(doc.targetId),
                            "targetType": doc.targetType,
                            "finalEmotion": result["final_emotion"],
                        }
                    )
                )

            except Exception as e:
                new_count = doc.retry_count + 1

                status = (
                    AnalysisStatusEnum.FAILED
                    if new_count < self.MAX_RETRY
                    else AnalysisStatusEnum.PERMANENT_FAILED
                )

                # ===============================
                # 4. UPDATE DB (FAILED)
                # ===============================
                await self.repo.update_analysis(doc.id, {
                    "retry_count": new_count,
                    "status": status,
                    "error_reason": str(e),
                    # giữ nguyên retry_scope để lần sau retry đúng loại
                    "updated_at": datetime.now(timezone.utc),
                })