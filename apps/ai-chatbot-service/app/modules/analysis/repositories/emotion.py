from motor.motor_asyncio import AsyncIOMotorCollection
from bson import ObjectId
from typing import List, Optional, Any
from datetime import datetime, timedelta, timezone
from app.modules.analysis.enums import EmotionTimeWindowEnum


class EmotionAggregateRepository:
    """
    Repository for EmotionAggregate collection.
    Unified repository combining legacy AnalysisRepository functionality.
    Enhanced with time-window queries for snapshot computation.
    """

    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    # ========================================================================
    # CREATE / UPDATE Operations
    # ========================================================================

    async def save(self, data: dict) -> dict:
        """
        Insert new emotion aggregate.
        
        Args:
            data: Emotion aggregate data
            
        Returns:
            Document with _id as string
        """
        data = self._normalize_timestamps(data)
        result = await self.collection.insert_one(data)
        data["_id"] = str(result.inserted_id)
        return data

    async def update(self, aggregate_id: str, update_data: dict) -> Optional[dict]:
        """
        Update emotion aggregate by ID.
        
        Args:
            aggregate_id: Aggregate ID (string or ObjectId)
            update_data: Fields to update
            
        Returns:
            Updated document or None if not found
        """
        try:
            obj_id = ObjectId(aggregate_id) if isinstance(aggregate_id, str) else aggregate_id
        except Exception:
            return None

        update_data = self._normalize_timestamps(update_data)

        result = await self.collection.update_one(
            {"_id": obj_id},
            {"$set": update_data}
        )

        if result.matched_count == 0:
            return None

        # Return updated document
        doc = await self.collection.find_one({"_id": obj_id})
        if doc:
            doc = self._normalize_output_document(doc)
        return doc

    # ========================================================================
    # READ Operations - Single Document
    # ========================================================================

    async def get_by_id(self, aggregate_id: str) -> Optional[dict]:
        """Get emotion aggregate by ID."""
        try:
            obj_id = ObjectId(aggregate_id)
        except Exception:
            return None
        
        doc = await self.collection.find_one({"_id": obj_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    async def get_by_target(self, target_id: str, target_type: str) -> Optional[dict]:
        """Get emotion aggregate by target ID and type."""
        doc = await self.collection.find_one({
            "targetId": target_id,
            "targetType": target_type
        })
        if doc:
            doc = self._normalize_output_document(doc)
        return doc

    # ========================================================================
    # READ Operations - Multiple Documents (Time-based queries)
    # ========================================================================

    async def get_user_recent_analyses(self, user_id: str, limit: int = 30) -> List[dict]:
        """
        Get recent analyses for user.
        
        Args:
            user_id: User ID
            limit: Maximum number of documents
            
        Returns:
            List of recent emotion aggregates
        """
        query = {"userId": user_id}
        
        cursor = self.collection.find(query).sort("createdAt", -1).limit(limit)
        docs = await cursor.to_list(length=limit)
        
        for doc in docs:
            self._normalize_output_document(doc)
        return docs

    async def get_by_user_since(
        self,
        user_id: str,
        since: datetime,
        reference_time: Optional[datetime] = None
    ) -> List[dict]:
        """
        Get emotion aggregates for snapshot computation.

        Optimized version:
        - Uses MongoDB projection to fetch only required fields
        - Reduces network and memory usage significantly

        Fields required by snapshot service:
        - createdAt
        - finalEmotion
        - finalScores
        - intensity
        """

        if reference_time is None:
            reference_time = datetime.now(timezone.utc)

        query = {
            "userId": user_id,
            "createdAt": {
                "$gte": since,
                "$lte": reference_time
            }
        }

        # Only fetch fields required for snapshot computation
        projection = {
            "_id": 0,
            "createdAt": 1,
            "finalEmotion": 1,
            "finalScores": 1,
            "intensity": 1,
        }

        cursor = (
            self.collection
            .find(query, projection)
            .sort("createdAt", 1)
        )

        docs = await cursor.to_list(length=None)

        return docs

    async def get_by_user_in_time_window(
        self,
        user_id: str,
        window: EmotionTimeWindowEnum,
        reference_time: Optional[datetime] = None
    ) -> List[dict]:
        """
        Get all emotion aggregates for a user within a time window.
        
        NOTE: For computing multiple windows, prefer get_by_user_since() to reduce queries.
        
        Args:
            user_id: User ID
            window: Time window (7d, 30d)
            reference_time: Reference time (defaults to now)
        
        Returns:
            List of emotion aggregates within the time window
        """
        if reference_time is None:
            reference_time = datetime.now(timezone.utc)

        window_delta = self._get_window_delta(window)
        start_time = reference_time - window_delta

        query = {
            "userId": user_id,
            "createdAt": {"$gte": start_time, "$lte": reference_time}
        }

        cursor = self.collection.find(query).sort("createdAt", -1)
        docs = await cursor.to_list(length=None)
        
        for doc in docs:
            self._normalize_output_document(doc)
        
        return docs

    async def get_history(
        self,
        user_id: str,
        start: datetime,
        end: datetime,
        cursor: Optional[datetime] = None,
        limit: int = 20
    ) -> List[dict]:
        """
        Get paginated history with date range filter.
        
        Args:
            user_id: User ID
            start: Start date
            end: End date
            cursor: Pagination cursor (createdAtVN datetime)
            limit: Maximum number of results
            
        Returns:
            List of emotion aggregates
        """
        query = {
            "userId": user_id,
            "createdAtVN": {
                "$gte": start,
                "$lte": end
            }
        }

        if cursor:
            query["createdAtVN"]["$lt"] = cursor

        cursor_obj = self.collection.find(query).sort("createdAtVN", -1).limit(limit)
        docs = await cursor_obj.to_list(length=limit)
        
        for doc in docs:
            self._normalize_output_document(doc)
        return docs

    async def get_all_for_summary(
        self,
        user_id: str,
        start: datetime,
        end: datetime
    ) -> List[dict]:
        """
        Get all analyses for summary in date range.
        Uses createdAtVN field for Vietnam timezone queries.
        
        Args:
            user_id: User ID
            start: Start date
            end: End date
            
        Returns:
            List of all emotion aggregates in range
        """
        query = {
            "userId": user_id,
            "createdAtVN": {
                "$gte": start,
                "$lte": end
            }
        }
        
        cursor = self.collection.find(query)
        docs = await cursor.to_list(length=None)
        
        for doc in docs:
            self._normalize_output_document(doc)
        return docs

    async def get_by_user_in_date_range(
        self,
        user_id: str,
        start_time: datetime,
        end_time: datetime
    ) -> List[dict]:
        """Get all emotion aggregates for a user within a date range."""
        query = {
            "userId": user_id,
            "createdAt": {"$gte": start_time, "$lte": end_time}
        }

        cursor = self.collection.find(query).sort("createdAt", -1)
        docs = await cursor.to_list(length=None)
        
        for doc in docs:
            self._normalize_output_document(doc)
        
        return docs

    async def count_by_user_in_time_window(
        self,
        user_id: str,
        window: EmotionTimeWindowEnum,
        reference_time: Optional[datetime] = None
    ) -> int:
        """Count emotion aggregates for a user within a time window."""
        if reference_time is None:
            reference_time = datetime.now(timezone.utc)

        window_delta = self._get_window_delta(window)
        start_time = reference_time - window_delta

        query = {
            "userId": user_id,
            "createdAt": {"$gte": start_time, "$lte": reference_time}
        }

        return await self.collection.count_documents(query)

    # ========================================================================
    # HELPER METHODS
    # ========================================================================

    def _get_window_delta(self, window: EmotionTimeWindowEnum) -> timedelta:
        """Convert window enum to timedelta."""
        window_map = {
            EmotionTimeWindowEnum.LAST_7_DAYS: timedelta(days=7),
            EmotionTimeWindowEnum.LAST_30_DAYS: timedelta(days=30),
        }
        return window_map.get(window, timedelta(days=7))

    def _normalize_timestamps(self, data: dict) -> dict:
        """Ensure aggregate timestamps are stored as UTC datetime objects."""
        normalized = dict(data)
        for field in ("createdAt", "updatedAt"):
            value = normalized.get(field)
            parsed = self._coerce_datetime_utc(value)
            if parsed is not None:
                normalized[field] = parsed
        return normalized

    def _normalize_output_document(self, doc: dict) -> dict:
        """Normalize Mongo document timestamp fields to UTC-aware datetimes."""
        doc["_id"] = str(doc["_id"])
        for field in ("createdAt", "updatedAt", "createdAtVN"):
            parsed = self._coerce_datetime_utc(doc.get(field))
            if parsed is not None:
                doc[field] = parsed
        return doc

    def _coerce_datetime_utc(self, value: Any) -> Optional[datetime]:
        """Convert timestamp input to timezone-aware UTC datetime when possible."""
        if value is None:
            return None

        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)

        if isinstance(value, str):
            candidate = value.strip()
            if candidate.endswith("Z"):
                candidate = f"{candidate[:-1]}+00:00"
            try:
                parsed = datetime.fromisoformat(candidate)
            except ValueError:
                return None

            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)

        return None
