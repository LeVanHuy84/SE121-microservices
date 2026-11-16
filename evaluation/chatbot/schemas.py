"""Pydantic schemas for Sentimeta Chatbot Benchmark Dataset and LLM-as-a-Judge Evaluation."""

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class BenchmarkCategory(str, Enum):
    MENTAL_HEALTH_PFA = "mental_health_pfa"
    CRISIS_SELF_HARM = "crisis_self_harm"
    IN_DOMAIN_APP_RAG = "in_domain_app_rag"
    OUT_OF_DOMAIN_ADVERSARIAL = "out_of_domain_adversarial"


class SourceStandard(str, Enum):
    EPITOME_WHO_PFA = "EPITOME_WHO_PFA"
    COLUMBIA_CSSRS_REDDIT = "Columbia_CSSRS_Reddit"
    SENTIMETA_RAG_CORPUS = "Sentimeta_RAG_Corpus"
    WHO_FDA_CLINICAL_BOUNDARY = "WHO_FDA_Clinical_Boundary"
    DO_NOT_ANSWER_ACL = "Do_Not_Answer_ACL"
    JAILBREAKBENCH_NEURIPS = "JailbreakBench_NeurIPS"
    BEAVERTAILS_SAFE_RLHF = "BeaverTails_SafeRLHF"
    HALLUCINATION_BENCHMARK = "Hallucination_Benchmark"
    OOD_SCOPE_GUARD = "OOD_ScopeGuard"


class EmotionType(str, Enum):
    JOY = "joy"
    SADNESS = "sadness"
    FEAR = "fear"
    ANGER = "anger"
    SURPRISE = "surprise"
    DISGUST = "disgust"
    NEUTRAL = "neutral"


class UserContext(BaseModel):
    user_id: str = Field(..., description="Unique test user identifier")
    current_emotion: Optional[EmotionType] = Field(
        EmotionType.NEUTRAL, description="Current detected emotion of the user"
    )
    distress_level: float = Field(
        0.0, ge=0.0, le=1.0, description="Distress level estimated from previous logs"
    )
    notes: Optional[str] = Field(None, description="Optional background note about the scenario")


class ReferenceGroundTruth(BaseModel):
    ideal_intent: str = Field(..., description="Core communication intent of the response")
    expected_elements: List[str] = Field(
        ..., description="List of mandatory key facts, actions, or psychological steps"
    )
    forbidden_behaviors: List[str] = Field(
        ..., description="List of strictly prohibited actions, words, or hallucinations"
    )
    reference_gist: str = Field(
        ..., description="Concise reference summary of an ideal 5-star response style"
    )


class EvaluationCriterion(str, Enum):
    FAITHFULNESS = "faithfulness"
    ANSWER_RELEVANCE = "answer_relevance"
    EMPATHY = "empathy"
    CLINICAL_SAFETY = "clinical_safety"
    CONTEXT_CONSISTENCY = "context_consistency"


# =========================================================================
# SINGLE-TURN SCHEMAS
# =========================================================================

class BenchmarkCase(BaseModel):
    id: str = Field(..., description="Unique case identifier, e.g. CASE_MH_001")
    category: BenchmarkCategory = Field(..., description="Category in the stratified matrix")
    subtopic: str = Field(..., description="Subtopic, e.g., exam_anxiety, group_creation, crisis_hotline")
    source_standard: SourceStandard = Field(
        ..., description="Academic benchmark provenance and standard reference"
    )
    query: str = Field(..., description="Raw user query in Vietnamese")
    user_context: UserContext = Field(..., description="Contextual state of the user")
    reference_ground_truth: ReferenceGroundTruth = Field(
        ..., description="Semantic Ground Truth constraints and expectations"
    )
    evaluation_criteria_focus: List[EvaluationCriterion] = Field(
        ..., description="Focus criteria that must be scored for this case"
    )


# =========================================================================
# MULTI-TURN SCHEMAS (ĐỐI THOẠI ĐA LƯỢT QUA LẠI)
# =========================================================================

class DialogueTurn(BaseModel):
    turn_index: int = Field(..., ge=1, description="Index of this conversational turn (1, 2, 3...)")
    user_query: str = Field(..., description="User query for this turn in Vietnamese")
    expected_elements: List[str] = Field(
        ..., description="Mandatory elements that bot must address in this turn"
    )
    forbidden_behaviors: List[str] = Field(
        ..., description="Forbidden responses/behaviors specific to this turn"
    )
    context_retention_check: Optional[str] = Field(
        None, description="Critical fact or emotion from earlier turns that bot must retain/not forget"
    )
    reference_gist: str = Field(..., description="Brief summary of an ideal 5-star response style for this turn")


class MultiTurnBenchmarkCase(BaseModel):
    dialogue_id: str = Field(..., description="Unique dialogue identifier, e.g. DLG_MH_001")
    category: BenchmarkCategory = Field(..., description="Category of the dialogue")
    title: str = Field(..., description="Human-readable title describing the multi-turn scenario")
    subtopic: str = Field(..., description="Subtopic, e.g. exam_burnout_escalation, group_privacy_inquiry")
    source_standard: SourceStandard = Field(
        ..., description="Academic benchmark provenance and standard reference"
    )
    user_context: UserContext = Field(..., description="Initial contextual state of the user")
    evaluation_criteria_focus: List[EvaluationCriterion] = Field(
        ..., description="Focus criteria evaluated across the conversation"
    )
    turns: List[DialogueTurn] = Field(
        ..., min_length=2, description="Sequence of conversational turns (at least 2 turns)"
    )


# =========================================================================
# JUDGE EVALUATION OUTPUT SCHEMAS
# =========================================================================

class SingleCriterionScore(BaseModel):
    criterion: EvaluationCriterion
    score: int = Field(..., ge=1, le=5, description="Likert score from 1 to 5")
    reasoning: str = Field(..., description="Chain-of-thought evidence and explanation")
    verdict: str = Field(..., description="PASS or FAIL based on criteria threshold")


class JudgeEvaluationResult(BaseModel):
    case_id: str
    category: BenchmarkCategory
    source_standard: SourceStandard
    bot_response: str
    scores: List[SingleCriterionScore]
    overall_pass: bool
    summary_verdict: str
