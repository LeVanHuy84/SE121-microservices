from typing import List, Optional
from pydantic import BaseModel, Field


class RecommendationCandidateInput(BaseModel):
    candidateId: str
    mutualFriends: int = 0
    interactionScore: float = 0
    similarityScore: Optional[float] = None
    candidateProfileText: Optional[str] = None
    sharedInterestCount: int = 0
    alreadyFriend: bool = False
    isBlocked: bool = False
    isReported: bool = False
    commonGroups: int = 0
    baseScore: float = 0
    reasons: List[str] = Field(default_factory=list)


class RecommendationRerankRequest(BaseModel):
    viewerId: str
    viewerProfileText: Optional[str] = None
    candidates: List[RecommendationCandidateInput] = Field(default_factory=list)


class RecommendationCandidateScore(BaseModel):
    candidateId: str
    modelScore: float
    reason: str


class FriendRecommendationOutput(BaseModel):
    user_id: str
    score: float
    reason: str
