from app.services.model_loader import model_loader

class TextClassifier:
    @staticmethod
    def classify_emotion(text: str):
        # gọi pipeline mới của BartPho Emotion
        result = model_loader.emotion_pipeline(text)[0]
        return {
            "label": result["label"],           # sẽ là 7 nhãn: Anger, Disgust, Enjoyment, Fear, Sadness, Surprise, Other
            "score": round(result["score"], 4)
        }

text_classifier = TextClassifier()
