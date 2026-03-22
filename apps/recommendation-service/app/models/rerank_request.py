from typing import List, Optional

from pydantic import BaseModel, Field


class RecommendationCandidateInput(BaseModel):
    candidateId: str
    mutualFriends: int = 0
    similarityScore: Optional[float] = None
    candidateProfileText: Optional[str] = None
    alreadyFriend: bool = False
    isBlocked: bool = False
    isReported: bool = False
    commonGroups: int = 0


class RecommendationRerankRequest(BaseModel):
    viewerId: str
    viewerProfileText: Optional[str] = None
    candidates: List[RecommendationCandidateInput] = Field(default_factory=list)


class RecommendationCandidateScore(BaseModel):
    candidateId: str
    modelScore: float
    reason: str
