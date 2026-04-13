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


class RecommendationCandidateScore(BaseModel):
    candidateId: str
    modelScore: float
    reason: str


class RecommendationQueryRequest(BaseModel):
    viewerId: str
    limit: int = Field(default=20, ge=1, le=100)
    cursor: Optional[str] = None
    viewerProfileText: Optional[str] = None


class RecommendationQueryCandidateOutput(BaseModel):
    candidateId: str
    source: str
    retrievalScore: float
    modelScore: float
    finalScore: float
    scoreVersion: str
    reasonCodes: List[str] = Field(default_factory=list)
    rank: int


class RecommendationQueryOutput(BaseModel):
    viewerId: str
    generatedAt: str
    source: str
    scoreVersion: str
    candidateCount: int
    nextCursor: Optional[str] = None
    hasNextPage: bool = False
    candidates: List[RecommendationQueryCandidateOutput] = Field(
        default_factory=list
    )
