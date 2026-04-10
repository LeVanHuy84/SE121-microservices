from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from threading import RLock


class RecommendationGraphStateStore:
    def __init__(self):
        self._lock = RLock()
        self._friendships: dict[str, set[str]] = defaultdict(set)
        self._outgoing_requests: dict[str, set[str]] = defaultdict(set)
        self._blocks: dict[str, set[str]] = defaultdict(set)
        self._dismissals: dict[str, dict[str, datetime]] = defaultdict(dict)
        self._last_event_at: str | None = None

    def apply_friend_request_sent(self, user_id: str, target_user_id: str):
        with self._lock:
            self._outgoing_requests[user_id].add(target_user_id)
            self._last_event_at = self._now_iso()

    def apply_friend_request_canceled(self, user_id: str, target_user_id: str):
        with self._lock:
            self._outgoing_requests[user_id].discard(target_user_id)
            self._last_event_at = self._now_iso()

    def apply_friend_request_accepted(self, user_id: str, target_user_id: str):
        with self._lock:
            self._outgoing_requests[target_user_id].discard(user_id)
            self._friendships[user_id].add(target_user_id)
            self._friendships[target_user_id].add(user_id)
            self._last_event_at = self._now_iso()

    def apply_friend_request_declined(self, user_id: str, target_user_id: str):
        with self._lock:
            self._outgoing_requests[target_user_id].discard(user_id)
            self._last_event_at = self._now_iso()

    def apply_friendship_removed(self, user_id: str, target_user_id: str):
        with self._lock:
            self._friendships[user_id].discard(target_user_id)
            self._friendships[target_user_id].discard(user_id)
            self._last_event_at = self._now_iso()

    def apply_user_blocked(self, user_id: str, target_user_id: str):
        with self._lock:
            self._blocks[user_id].add(target_user_id)
            self._friendships[user_id].discard(target_user_id)
            self._friendships[target_user_id].discard(user_id)
            self._outgoing_requests[user_id].discard(target_user_id)
            self._outgoing_requests[target_user_id].discard(user_id)
            self._last_event_at = self._now_iso()

    def apply_user_unblocked(self, user_id: str, target_user_id: str):
        with self._lock:
            self._blocks[user_id].discard(target_user_id)
            self._last_event_at = self._now_iso()

    def apply_recommendation_dismissed(
        self, user_id: str, target_user_id: str, expires_at: datetime
    ):
        with self._lock:
            self._dismissals[user_id][target_user_id] = expires_at
            self._last_event_at = self._now_iso()

    def has_friendship(self, user_id: str, target_user_id: str) -> bool:
        with self._lock:
            return target_user_id in self._friendships.get(user_id, set())

    def has_pending_request(self, user_id: str, target_user_id: str) -> bool:
        with self._lock:
            return target_user_id in self._outgoing_requests.get(user_id, set())

    def is_blocked(self, user_id: str, target_user_id: str) -> bool:
        with self._lock:
            return target_user_id in self._blocks.get(user_id, set())

    def has_active_dismissal(self, user_id: str, target_user_id: str) -> bool:
        with self._lock:
            expires_at = self._dismissals.get(user_id, {}).get(target_user_id)
            if expires_at is None:
                return False

            if expires_at <= datetime.now(timezone.utc):
                self._dismissals[user_id].pop(target_user_id, None)
                return False

            return True

    def get_summary(self) -> dict[str, int | str | None]:
        with self._lock:
            active_dismissals = 0
            now = datetime.now(timezone.utc)
            for user_id, candidates in self._dismissals.items():
                expired_candidates = [
                    candidate_id
                    for candidate_id, expires_at in candidates.items()
                    if expires_at <= now
                ]
                for candidate_id in expired_candidates:
                    candidates.pop(candidate_id, None)
                active_dismissals += len(candidates)

            return {
                "usersWithFriendships": sum(
                    1 for friends in self._friendships.values() if friends
                ),
                "friendshipEdges": sum(len(friends) for friends in self._friendships.values()),
                "usersWithPendingRequests": sum(
                    1
                    for pending_targets in self._outgoing_requests.values()
                    if pending_targets
                ),
                "pendingRequestEdges": sum(
                    len(pending_targets)
                    for pending_targets in self._outgoing_requests.values()
                ),
                "usersWithBlocks": sum(1 for blocked in self._blocks.values() if blocked),
                "blockEdges": sum(len(blocked) for blocked in self._blocks.values()),
                "activeDismissals": active_dismissals,
                "lastEventAt": self._last_event_at,
            }

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()


graph_state_store = RecommendationGraphStateStore()
