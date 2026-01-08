import asyncio
import json
import uuid
from datetime import datetime
from app.redis.redis_client import redis_client


class OutboxBatchProcessor:
    LOCK_KEY = "outbox_processor_lock"
    LOCK_TTL = 10  # giây

    def __init__(self, outbox_repo, kafka_producer):
        self.outbox_repo = outbox_repo
        self.kafka = kafka_producer
        self.instance_id = str(uuid.uuid4())   # mỗi pod / service instance có id riêng

    # --------------------------------------------------
    # 1. Attempt lock
    # --------------------------------------------------
    async def acquire_lock(self):
        """
        SETNX lock_key instance_id EX LOCK_TTL
        return True nếu lock thành công
        """
        return await redis_client.set(
            self.LOCK_KEY,
            self.instance_id,
            ex=self.LOCK_TTL,
            nx=True
        )

    async def refresh_lock(self):
        """
        Chỉ instance sở hữu lock mới được refresh.
        """
        owner = await redis_client.get(self.LOCK_KEY)
        if owner != self.instance_id:
            return False

        await redis_client.expire(self.LOCK_KEY, self.LOCK_TTL)
        return True

    # --------------------------------------------------
    # 2. Main loop
    # --------------------------------------------------
    async def start(self, interval_seconds=5):
        print("[BatchProcessor] Started with instance:", self.instance_id)

        while True:
            try:
                has_lock = await self.acquire_lock()

                if not has_lock:
                    # Không lấy được lock -> thằng khác đang chạy
                    await asyncio.sleep(interval_seconds)
                    continue

                # Lấy được lock rồi -> chạy batch
                await self.process_batch()

                # Refresh lock để tránh hết TTL trong khi chạy
                await self.refresh_lock()

            except Exception as e:
                print("Batch processor error:", e)

            await asyncio.sleep(interval_seconds)

    # --------------------------------------------------
    # 3. Process Outbox Batch
    # --------------------------------------------------
    async def process_batch(self):
        outboxes = await self.outbox_repo.get_pending_outboxes(limit=200)
        if not outboxes:
            return

        print(f"[Batch] Processing {len(outboxes)} outboxes...")

        # Prepare all send tasks
        send_tasks = []
        for outbox in outboxes:
            kafka_message = {
                "type": outbox.eventType,
                "payload": outbox.payload
            }
            send_tasks.append(
                self.kafka.send(topic=outbox.topic, message=kafka_message)
            )

        # Execute all sends in parallel
        results = await asyncio.gather(*send_tasks, return_exceptions=True)

        # Collect successful sends
        processed_ids = []
        for idx, (outbox, result) in enumerate(zip(outboxes, results)):
            if isinstance(result, Exception):
                print(f"[Batch] Kafka send error for outbox {outbox.id}: {result}")
            else:
                processed_ids.append(outbox.id)

        if processed_ids:
            await self.outbox_repo.mark_many_processed(processed_ids)

        print(f"[Batch] Done. Processed {len(processed_ids)}/{len(outboxes)}")
