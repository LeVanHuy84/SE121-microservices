"""
Script để pre-download models trước khi chạy service.
Chạy script này một lần để download ~3.5GB models.

Usage:
    python download_models.py
"""

import sys
import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

def main():
    logger.info("=" * 70)
    logger.info("🚀 Analysis Service V2.0 (Optimized) - Model Downloader")
    logger.info("=" * 70)
    logger.info("")
    logger.info("This script will download ~500MB of AI models:")
    logger.info("  1. PhoBERT Emotion (~135MB)")
    logger.info("  2. CLIP ViT-B-32 (~350MB)")
    logger.info("")
    logger.info("Models will be cached in: ~/.cache/huggingface/hub/")
    logger.info("You only need to run this once.")
    logger.info("")
    logger.info("=" * 70)
    
    try:
        from app.services.model_loader import ensure_models_loaded
        
        logger.info("Starting download...")
        logger.info("")
        
        ensure_models_loaded()
        
        logger.info("")
        logger.info("=" * 70)
        logger.info("✅ SUCCESS! All models downloaded and ready to use.")
        logger.info("=" * 70)
        logger.info("")
        logger.info("You can now run the service:")
        logger.info("  npm run start:dev")
        logger.info("")
        
        return 0
        
    except Exception as e:
        logger.error("=" * 70)
        logger.error("❌ ERROR: Model download failed")
        logger.error("=" * 70)
        logger.exception(e)
        logger.error("")
        logger.error("Common fixes:")
        logger.error("  1. Check internet connection")
        logger.error("  2. Ensure enough disk space (~4GB)")
        logger.error("  3. Try again (downloads resume automatically)")
        logger.error("")
        return 1

if __name__ == "__main__":
    sys.exit(main())
