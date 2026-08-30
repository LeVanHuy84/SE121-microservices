import sys
import asyncio
from pathlib import Path

# Thêm root directory của ai-chatbot-service vào sys.path để python import đúng app.modules...
ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.modules.analysis.enums import TargetTypeEnum
from app.modules.analysis.services.ml_models.model_loader import model_loader
from app.modules.analysis.services.orchestration.analysis_flow_service import AnalysisFlowService


async def main():
    print("==================================================")
    print("  Đang khởi tạo các model AI (PhoBERT, CLIP, ...)")
    print("==================================================")
    
    # Khởi tạo toàn bộ các model AI cần thiết
    try:
        model_loader.initialize()
        print("\n[SUCCESS] Khởi tạo AI models thành công!\n")
    except Exception as e:
        print(f"\n[ERROR] Lỗi khi load AI models: {e}")
        return

    # Khởi tạo AnalysisFlowService (Orchestrator)
    orchestrator = AnalysisFlowService()

    print("==================================================")
    print("  PHOBERT & ANALYSIS ORCHESTRATION TERMINAL DEMO  ")
    print("==================================================")
    print("Gõ văn bản để phân tích cảm xúc & kiểm duyệt.")
    print("Gõ 'exit' hoặc 'quit' để thoát.\n")

    while True:
        try:
            text = input(">> Nhập text: ").strip()
            if not text:
                continue
            if text.lower() in ["exit", "quit"]:
                print("Đã thoát demo.")
                break

            print("\n... Đang chạy Orchestration (Phân tích cảm xúc & Kiểm duyệt) ...")
            
            # Gọi orchestration service đầy đủ
            result = await orchestrator.analyze_content(
                text=text,
                image_urls=[],
                target_type=TargetTypeEnum.POST
            )

            print("\n---------------- KẾT QUẢ PHÂN TÍCH ----------------")
            print(f"Text gốc: {text}")
            
            emotion = result.get('emotion')
            if emotion:
                print(f"Modality chính: {emotion.get('dominantModality')}")
                print("\n[Cảm xúc (PhoBERT Emotion & Fusion)]")
                print(f"  - Cảm xúc chính (primaryEmotion):   {emotion.get('primaryEmotion')}")
                print(f"  - Cảm xúc phụ (secondaryEmotions): {emotion.get('secondaryEmotions')}")
                print(f"  - Độ tin cậy (finalConfidence):     {emotion.get('finalConfidence'):.2f}" if emotion.get('finalConfidence') is not None else "  - Độ tin cậy: N/A")
                print(f"  - Cường độ (Intensity):             {emotion.get('intensity')}")
                print(f"  - Phân bố điểm số (finalScores):     {emotion.get('finalScores')}")
                
                text_res = emotion.get('textResult', {})
                if text_res:
                    print("\n[Chi tiết PhoBERT Text Result]")
                    print(f"  - Primary Emotion:   {text_res.get('primaryEmotion')}")
                    print(f"  - Secondary Emotions:{text_res.get('secondaryEmotions')}")
                    print(f"  - Confidence:        {text_res.get('confidence')}")

            moderation = result.get('moderation')
            if moderation:
                print("\n[Kiểm duyệt (Moderation)]")
                print(f"  - Vi phạm (isViolation):    {moderation.get('isViolation')}")
                print(f"  - Điểm vi phạm:             {moderation.get('violationScore')}")
                print(f"  - Mức độ nghiêm trọng:      {moderation.get('maxSeverity')}")
                print(f"  - Chi tiết kiểm duyệt text: {moderation.get('textResult')}")
            
            print("---------------------------------------------------\n")

        except KeyboardInterrupt:
            print("\nĐã thoát demo.")
            break
        except Exception as e:
            print(f"\n[ERROR] Lỗi khi phân tích: {e}\n")


if __name__ == "__main__":
    asyncio.run(main())
