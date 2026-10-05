import unittest
from unittest.mock import AsyncMock
from app.modules.analysis.messaging.consumer_helper import KafkaConsumerHelper


class TestKafkaIntegrity(unittest.IsolatedAsyncioTestCase):

    async def test_idempotency_filtering(self):
        # Mock IdempotencyRepository & DLQ
        mock_idempotency = AsyncMock()
        mock_dlq = AsyncMock()

        # Giả lập Mongo đã lưu eventId "event_1" (đã xử lý)
        mock_idempotency.filter_unprocessed_event_ids.return_value = {"event_2"}
        mock_idempotency.try_acquire.return_value = True

        helper = KafkaConsumerHelper(mock_idempotency, mock_dlq, max_retries=2)
        mock_handler = AsyncMock()

        batch_messages = [
            {"eventId": "event_1", "content": "Bài viết đã xử lý trước đó"},
            {"eventId": "event_2", "content": "Bài viết mới chưa xử lý"}
        ]

        await helper.handle_batch(batch_messages, mock_handler, topic="test-events")

        # Confirm handler chỉ được gọi 1 lần cho event_2
        self.assertEqual(mock_handler.call_count, 1)
        mock_handler.assert_called_once_with(batch_messages[1])

    async def test_retry_and_dlq_on_failure(self):
        mock_idempotency = AsyncMock()
        mock_dlq = AsyncMock()
        mock_idempotency.try_acquire.return_value = True

        helper = KafkaConsumerHelper(mock_idempotency, mock_dlq, max_retries=2, initial_backoff_sec=0.01)
        
        # Handler luôn quăng lỗi exception
        mock_handler = AsyncMock(side_effect=RuntimeError("Groq VLM API Down"))

        msg = {"eventId": "event_failed", "content": "Bài viết gây lỗi"}

        await helper.handle_single(msg, mock_handler, topic="test-events")

        # Confirm đã retry đúng 2 lần
        self.assertEqual(mock_handler.call_count, 2)
        
        # Confirm đã mark_failed và gửi sang DLQ
        mock_idempotency.mark_failed.assert_called_once()
        mock_dlq.send_to_dlq.assert_called_once()


if __name__ == "__main__":
    unittest.main()
