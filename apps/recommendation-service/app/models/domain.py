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

@dataclass
class EmotionProfile:
    user_id: str
    risk_score: float
    recent_negativity_score: float
    dominant_emotion: str | None
    emotion_scores: dict[str, float]
    source_event_at: datetime | None = None
    updated_at: datetime | None = None

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
