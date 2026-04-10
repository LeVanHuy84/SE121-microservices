from typing import List, Optional

from pydantic import BaseModel, Field


class RecommendationCandidateInput(BaseModel):
    candidateId: str
    mutualFriends: int = 0
    candidateProfileText: Optional[str] = None
    alreadyFriend: bool = False
    isBlocked: bool = False
    isReported: bool = False
    commonGroups: int = 0


class RecommendationRerankRequest(BaseModel):
    viewerId: str
    viewerProfileText: Optional[str] = None
    candidates: List[RecommendationCandidateInput] = Field(default_factory=list)


class RecommendationEmbeddingItemInput(BaseModel):
    entityId: str
    profileText: Optional[str] = None


class RecommendationEmbeddingRequest(BaseModel):
    items: List[RecommendationEmbeddingItemInput] = Field(default_factory=list)


class RecommendationCandidateScore(BaseModel):
    candidateId: str
    modelScore: float
    reason: str


class RecommendationEmbeddingOutput(BaseModel):
    entityId: str
    embedding: List[float]


class PrecomputedRecommendationCandidateOutput(BaseModel):
    candidateId: str
    semanticScore: float
    rank: int
    generatedAt: str
