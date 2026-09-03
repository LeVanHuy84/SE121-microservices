import asyncio
from pathlib import Path
import sys

# Thêm root directory của ai-chatbot-service vào sys.path
ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# Đảm bảo UTF-8 console output
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from app.modules.analysis.enums import TargetTypeEnum  # noqa: E402
from app.modules.analysis.services.ml_models.model_loader import model_loader  # noqa: E402
from app.modules.analysis.services.orchestration.analysis_flow_service import AnalysisFlowService  # noqa: E402


async def main():
    print("======================================================================")
    print("  SE121 ANALYSIS SERVICE - INTERACTIVE CLI TEST RUNNER")
    print("  (Pipeline thử nghiệm 100% In-Memory: Không ghi DB / Không phát Kafka)")
    print("======================================================================")
    
    print("\n[1/2] Đang khởi tạo các Mô hình AI (PhoBERT + VLM Analyzer)...")
    try:
        model_loader.initialize()
        print("[SUCCESS] Khởi tạo AI models thành công!\n")
    except Exception as e:
        print(f"[ERROR] Lỗi khi load AI models: {e}")
        return

    orchestrator = AnalysisFlowService()

    print("======================================================================")
    print("  HƯỚNG DẪN SỬ DỤNG:")
    print("  - Nhập Text và URL/Đường dẫn Ảnh để thử nghiệm Phân tích Đa phương thức.")
    print("  - Để trống Ảnh (nhấn ENTER) nếu bài viết chỉ có chữ (Text-Only PhoBERT).")
    print("  - Gõ 'exit' hoặc 'quit' để thoát.")
    print("======================================================================\n")

    while True:
        try:
            text = input("\n>> Nhập Nội dung (Status/Text): ").strip()
            if text.lower() in ["exit", "quit"]:
                print("Đã thoát chương trình kiểm thử CLI.")
                break

            images_str = input(">> Nhập URL hoặc Đường dẫn Ảnh (cách nhau dấu phẩy, nhấn ENTER nếu không có ảnh): ").strip()
            
            image_urls = []
            if images_str:
                image_urls = [x.strip() for x in images_str.split(",") if x.strip()]

            if not text and not image_urls:
                print("[WARN] Vui lòng nhập ít nhất Text hoặc Ảnh!")
                continue

            print("\n... Đang chạy Pipeline Phân tích (Moderation + Emotion) ...")
            
            # Chạy thử nghiệm qua Orchestrator (chỉ tính toán, không ghi DB)
            result = await orchestrator.analyze_content(
                text=text,
                image_urls=image_urls,
                target_type=TargetTypeEnum.POST
            )

            print("\n======================= KẾT QUẢ PHÂN TÍCH =======================")
            
            moderation = result.get('moderation', {})
            emotion = result.get('emotion', {})
            should_block = result.get('shouldBlock', False)

            # 1. KIỂM DUYỆT (MODERATION)
            print("🛡️ [KIỂM DUYỆT AN TOÀN - MODERATION]")
            print(f"  - Kết luận:               {'🚫 VI PHẠM (CHẶN BÀI)' if should_block else '✅ AN TOÀN'}")
            print(f"  - Nguồn xử lý (Pipeline): {moderation.get('pipelineSource', 'PHOBERT_TEXT')}")
            print(f"  - Vi phạm (isViolation):  {moderation.get('isViolation')}")
            print(f"  - Điểm vi phạm:           {moderation.get('violationScore')}")
            print(f"  - Mức độ nghiêm trọng:    {moderation.get('maxSeverity')}")
            if moderation.get('flaggedCategories'):
                print(f"  - Danh mục vi phạm:       {moderation.get('flaggedCategories')}")
            if moderation.get('reason'):
                print(f"  - Lý do chi tiết:         {moderation.get('reason')}")

            # 2. CẢM XÚC (EMOTION)
            if emotion:
                print("\n🎭 [PHÂN TÍCH CẢM XÚC - EMOTION]")
                print(f"  - Modality xử lý:         {emotion.get('dominantModality')}")
                print(f"  - Cảm xúc chính (Primary): {emotion.get('primaryEmotion')}")
                print(f"  - Cảm xúc phụ (Secondary): {emotion.get('secondaryEmotions')}")
                print(f"  - Độ tin cậy (Confidence): {emotion.get('finalConfidence'):.4f}" if emotion.get('finalConfidence') is not None else "  - Độ tin cậy: N/A")
                print(f"  - Cường độ (Intensity):    {emotion.get('intensity')}")
                
                # Sarcasm / Conflict
                if emotion.get('isSarcasmOrConflict'):
                    print("\n⚠️ [PHÁT HIỆN MÂU THUẪN / MỈA MAI (SARCASM)]")
                    print("  - Có mâu thuẫn:           True")
                    print(f"  - Giải thích:             {emotion.get('conflictExplanation')}")

                # Emotion scores 7 nhãn
                scores = emotion.get('finalScores', {})
                if scores:
                    print("\n📊 [BẢNG ĐIỂM 7 NHÃN CẢM XÚC (TỔNG = 1.0)]")
                    for k, v in scores.items():
                        bar = "█" * int(v * 20)
                        print(f"  - {k:<10}: {v:.4f} | {bar}")

            print("=================================================================\n")

        except KeyboardInterrupt:
            print("\nĐã thoát CLI.")
            break
        except Exception as e:
            print(f"\n[ERROR] Lỗi thực thi: {e}\n")


if __name__ == "__main__":
    asyncio.run(main())
