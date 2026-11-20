import asyncio
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


async def main():
    print("=" * 60)
    print("  SENTIMETA AI CHATBOT — PRE-WARMUP MODELS & EMBEDDINGS")
    print("=" * 60)

    # 1. AI Analysis models (PhoBERT Emotion & Moderation)
    print("\n[*] 1/3: Checking AI Analysis Models (PhoBERT & Moderation)...")
    t0 = time.perf_counter()
    from app.modules.analysis.services.ml_models.model_loader import (
        ensure_models_loaded,
    )

    await asyncio.to_thread(ensure_models_loaded)
    print(f"    ✓ AI Analysis models ready ({time.perf_counter() - t0:.2f}s)")

    # 2. Embedding Model (Xenova/multilingual-e5-base)
    print("\n[*] 2/3: Checking / Downloading ONNX Embedding Model (E5)...")
    t0 = time.perf_counter()
    from app.modules.chatbot.services.embedding import embedding_service

    test_vec = embedding_service.encode_query("Warmup Sentimeta AI Assistant")
    print(
        f"    ✓ Embedding model ready (Dim: {len(test_vec)}, {time.perf_counter() - t0:.2f}s)"
    )

    # 3. Stage 2 Semantic Centroids
    print("\n[*] 3/3: Pre-warming Stage 2 Guardrail Centroids...")
    t0 = time.perf_counter()
    from app.modules.chatbot.services.guardrails import stage2_guard_verifier

    await stage2_guard_verifier.warm_up_centroids_async()
    print(f"    ✓ Stage 2 Centroids warmed up ({time.perf_counter() - t0:.2f}s)")

    print("\n" + "=" * 60)
    print("  ✅ TẤT CẢ MODEL ĐÃ SẴN SÀNG! BẬT SERVER SẼ KHỞI ĐỘNG TRONG 1S.")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
