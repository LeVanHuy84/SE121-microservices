from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class GraphPairFeature:
    viewer_id: str
    candidate_id: str
    has_friendship: bool
    has_pending_request: bool
    is_blocked_either_way: bool
    has_active_dismissal: bool
    mutual_friend_count: int
    last_event_type: str | None = None
    last_event_at: datetime | None = None
    updated_at: datetime | None = None

    def calculate_score(self) -> float:
        from app.core.config import settings

        mutual_friend_cap = max(1, int(settings.RECOMMENDATION_MUTUAL_FRIEND_CAP))
        mutual_friend_score = min(
            self.mutual_friend_count,
            mutual_friend_cap,
        ) / mutual_friend_cap

        recent_event_score = 0.0
        last_event_type = self.last_event_type or ""
        if last_event_type in {
            "recommendation.graph.user-unblocked",
            "recommendation.graph.friend-request-canceled",
        }:
            recent_event_score = 0.1

        return _clamp_score(
            0.7 * mutual_friend_score
            + recent_event_score
        )

    def build_reason_codes(self) -> list[str]:
        reasons = []
        if self.mutual_friend_count > 0:
            reasons.append("graph_mutual_friend")
        if self.calculate_score() > 0:
            reasons.append("graph_rerank")

        last_event_type = self.last_event_type or ""
        if last_event_type == "recommendation.graph.user-unblocked":
            reasons.append("graph_recent_unblock")
        elif last_event_type == "recommendation.graph.friend-request-canceled":
            reasons.append("graph_recent_request_canceled")
        elif last_event_type == "recommendation.graph.friendship-removed":
            reasons.append("graph_recent_friendship_removed")

        return reasons

@dataclass
class EmotionProfile:
    user_id: str
    risk_score: float
    recent_negativity_score: float
    dominant_emotion: str | None
    emotion_scores: dict[str, float]
    source_event_at: datetime | None = None
    updated_at: datetime | None = None

    def calculate_affinity(self, candidate_emotion: 'EmotionProfile | None') -> float:
        from app.core.config import settings
        
        if not settings.RECOMMENDATION_EMOTION_SCORING_ENABLED:
            return 0.0
        if not candidate_emotion:
            return 0.0
        if self.is_stale() or candidate_emotion.is_stale():
            return 0.0

        viewer_negativity = _clamp_score(self.recent_negativity_score)
        candidate_negativity = _clamp_score(candidate_emotion.recent_negativity_score)
        viewer_risk = _clamp_score(self.risk_score)
        candidate_risk = _clamp_score(candidate_emotion.risk_score)

        stability_complementarity = 1.0 - (viewer_negativity + candidate_negativity) / 2.0
        risk_penalty = max(0.0, (viewer_risk + candidate_risk) / 2.0 - 0.7) * 0.5
        
        base_score = 0.75 * stability_complementarity + 0.25 * (1.0 - candidate_risk)
        
        return _clamp_score(base_score - risk_penalty)

    def is_stale(self) -> bool:
        from app.core.config import settings
        from datetime import timezone
        
        if not self.updated_at:
            return True
        max_age_hours = max(1, int(settings.RECOMMENDATION_EMOTION_DATA_MAX_AGE_HOURS))
        age_seconds = (datetime.now(timezone.utc) - self.updated_at.replace(tzinfo=timezone.utc)).total_seconds()
        return age_seconds > max_age_hours * 3600

def _clamp_score(value: float | None) -> float:
    if value is None:
        return 0.0
    return max(0.0, min(1.0, float(value)))

@dataclass
class ProfileMetadata:
    user_id: str
    semantic_profile_text: str | None
    dimensions: int
    updated_at: datetime | None = None

@dataclass
class RankedCandidate:
    candidate_id: str
    retrieval_score: float = 0.0
    model_score: float = 0.0
    graph_score: float = 0.0
    emotion_score: float = 0.0
    final_score: float = 0.0
    rank: int = 0
    reason_codes: list[str] = field(default_factory=list)
