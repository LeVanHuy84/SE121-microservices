import pytest
from app.modules.chatbot.schemas import AssistantContextItem, AssistantRespondRequest
from app.modules.chatbot.services.emotion_context import EmotionSnapshot
from app.modules.chatbot.services.context_resolver import AssistantContextResolver

def test_emotion_aware_boosting():
    resolver = AssistantContextResolver()
    
    # Base items with same score
    contexts = [
        AssistantContextItem(id="1", type="help_doc", title="Sơ cứu tâm lý", content="PFA content", score=1.0, source="rag", metadata={"topic": "pfa"}),
        AssistantContextItem(id="2", type="help_doc", title="Thở 4-7-8", content="CBT content", score=1.0, source="rag", metadata={"topic": "phuong-phap-chua-tri"}),
        AssistantContextItem(id="3", type="help_doc", title="Đại cương", content="Academic", score=1.0, source="rag", metadata={"topic": "giao-trinh-chuyen-nganh"}),
    ]
    
    # 1. High risk -> pfa boosted
    high_risk_snapshot = EmotionSnapshot(primary_emotion="fear", risk_level="high")
    ranked = resolver._rank_contexts("test query", contexts, high_risk_snapshot)
    
    assert ranked[0].id == "1" # PFA heavily boosted
    assert ranked[1].id == "2" # Phương pháp boosted slightly due to negative emotion
    assert ranked[2].id == "3" # Giao trinh depressed
    
    # 2. Sadness but no risk -> phuong phap chua tri boosted
    sad_snapshot = EmotionSnapshot(primary_emotion="sadness", risk_level="none")
    ranked2 = resolver._rank_contexts("test query", contexts, sad_snapshot)
    
    assert ranked2[0].id == "2" # CBT/self-care boosted
    assert ranked2[2].id == "3" # Giao trinh depressed
    
    # 3. Neutral -> just lexical score
    neutral_snapshot = EmotionSnapshot(primary_emotion="neutral", risk_level="none")
    ranked3 = resolver._rank_contexts("test query", contexts, neutral_snapshot)
    
    # No emotion boost, fallback to original score/lexical
    assert len(ranked3) == 3
