from dotenv import load_dotenv
import os

load_dotenv()

class Settings:
    PORT: int = int(os.getenv("PORT", 4010))
    HOST: str = os.getenv("HOST", "0.0.0.0")

    # Model config
    # MODEL_PATH: str = os.getenv("MODEL_PATH", "models/emotion_model.pkl")

    # Kafka config
    # KAFKA_BOOTSTRAP: str = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
    # KAFKA_TOPIC: str = os.getenv("KAFKA_TOPIC", "emotion-input")

settings = Settings()
