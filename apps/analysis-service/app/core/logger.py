import logging
from logging.handlers import RotatingFileHandler
import os

# Tạo thư mục logs nếu chưa tồn tại
LOG_DIR = "logs"
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

# File log: logs/app.log
LOG_FILE = os.path.join(LOG_DIR, "app.log")

# Format log
LOG_FORMAT = "%(asctime)s - %(levelname)s - %(name)s - %(message)s"

# Tạo logger
logger = logging.getLogger("analysis-service")
logger.setLevel(logging.INFO)

# --- Console Handler ---
console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter(LOG_FORMAT))

# --- File Handler ---
file_handler = RotatingFileHandler(
    LOG_FILE,
    maxBytes=5 * 1024 * 1024,   # 5MB/file
    backupCount=5               # giữ 5 file log cũ
)
file_handler.setFormatter(logging.Formatter(LOG_FORMAT))

# Add handlers nếu chưa add
if not logger.handlers:
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)
