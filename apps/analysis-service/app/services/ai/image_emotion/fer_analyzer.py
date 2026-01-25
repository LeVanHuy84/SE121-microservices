# app/services/ai/image_emotion/fer_analyzer.py

"""
FER (Facial Emotion Recognition) for Image Emotion Analysis
- Detects faces in images
- Classifies facial emotions
- Aggregates multiple faces
"""

import logging
import numpy as np
import cv2
from PIL import Image
from io import BytesIO
import torch

logger = logging.getLogger(__name__)


class FERAnalyzer:
    """
    Facial Emotion Recognition using pre-trained FER model.
    
    Architecture: AI Layer - Model inference only
    - No business logic
    - No domain rules
    - Returns raw emotion scores
    """
    
    _instance_initialized = False
    
    def __init__(self):
        self.model = None
        self.device = None
        self.face_cascade = None
        
        # FER emotion labels (standard FER+ format)
        self.emotion_labels = [
            "anger",
            "disgust", 
            "fear",
            "joy",      # happy
            "sadness",
            "surprise",
            "neutral"
        ]
    
    def initialize(self):
        """Initialize FER model and face detector."""
        if self._instance_initialized:
            return
        
        try:
            # Load face cascade for face detection
            self.face_cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
            )
            
            # Load FER model (using torchvision or custom model)
            # For now, using a simple approach with DeepFace or similar
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            
            # TODO: Load actual FER model
            # Example: self.model = torch.load('fer_model.pth')
            # For now, we'll use a placeholder
            
            logger.info("[FERAnalyzer] FER model initialized")
            self._instance_initialized = True
            
        except Exception as e:
            logger.error(f"[FERAnalyzer] Failed to initialize: {e}")
            raise
    
    def analyze_image(self, image_data: bytes) -> dict:
        """
        Analyze emotions in image using facial recognition.
        
        Args:
            image_data: Image bytes
            
        Returns:
            {
                "dominant_emotion": str,
                "emotions": dict,  # emotion -> score
                "confidence": float,
                "face_count": int,
                "model": "fer"
            }
        """
        if not self._instance_initialized:
            self.initialize()
        
        try:
            # Convert bytes to image
            image = self._bytes_to_image(image_data)
            
            # Detect faces
            faces = self._detect_faces(image)
            
            if not faces or len(faces) == 0:
                # No faces detected - return neutral with low confidence
                logger.warning("[FERAnalyzer] No faces detected in image")
                return {
                    "dominant_emotion": "neutral",
                    "emotions": {
                        "anger": 0.0,
                        "disgust": 0.0,
                        "fear": 0.0,
                        "joy": 0.0,
                        "sadness": 0.0,
                        "surprise": 0.0,
                        "neutral": 1.0
                    },
                    "confidence": 0.3,
                    "face_count": 0,
                    "model": "fer"
                }
            
            # Analyze each face
            face_emotions = []
            for (x, y, w, h) in faces:
                face_roi = image[y:y+h, x:x+w]
                emotion_scores = self._predict_emotion(face_roi)
                face_emotions.append(emotion_scores)
            
            # Aggregate multiple faces
            aggregated_scores = self._aggregate_emotions(face_emotions)
            
            # Get dominant emotion
            dominant = max(aggregated_scores, key=aggregated_scores.get)
            confidence = aggregated_scores[dominant]
            
            return {
                "dominant_emotion": dominant,
                "emotions": aggregated_scores,
                "confidence": round(confidence, 4),
                "face_count": len(faces),
                "model": "fer"
            }
            
        except Exception as e:
            logger.exception(f"[FERAnalyzer] Error analyzing image: {e}")
            raise
    
    def _bytes_to_image(self, image_data: bytes) -> np.ndarray:
        """Convert image bytes to OpenCV format."""
        image = Image.open(BytesIO(image_data)).convert("RGB")
        return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    
    def _detect_faces(self, image: np.ndarray) -> list:
        """Detect faces in image using Haar Cascade."""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(
            gray, 
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(30, 30)
        )
        return faces
    
    def _predict_emotion(self, face_roi: np.ndarray) -> dict:
        """
        Predict emotion from face ROI.
        
        Args:
            face_roi: Face region of interest
            
        Returns:
            Emotion scores dict
        """
        # TODO: Implement actual FER model inference
        # For now, return mock predictions based on simple heuristics
        
        # Resize face to model input size (typically 48x48 for FER)
        face_resized = cv2.resize(face_roi, (48, 48))
        gray_face = cv2.cvtColor(face_resized, cv2.COLOR_BGR2GRAY)
        
        # Placeholder: Use image statistics as simple heuristic
        # In production, this should use actual FER model
        brightness = np.mean(gray_face)
        contrast = np.std(gray_face)
        
        # Simple heuristic (REPLACE with actual model)
        if brightness > 150 and contrast > 40:
            # Bright, high contrast - likely happy/surprise
            scores = {
                "anger": 0.05,
                "disgust": 0.05,
                "fear": 0.05,
                "joy": 0.60,
                "sadness": 0.05,
                "surprise": 0.15,
                "neutral": 0.05
            }
        elif brightness < 100:
            # Dark - likely sad/anger
            scores = {
                "anger": 0.20,
                "disgust": 0.10,
                "fear": 0.15,
                "joy": 0.05,
                "sadness": 0.35,
                "surprise": 0.05,
                "neutral": 0.10
            }
        else:
            # Normal - neutral/mixed
            scores = {
                "anger": 0.10,
                "disgust": 0.10,
                "fear": 0.10,
                "joy": 0.20,
                "sadness": 0.15,
                "surprise": 0.10,
                "neutral": 0.25
            }
        
        return scores
    
    def _aggregate_emotions(self, face_emotions: list) -> dict:
        """
        Aggregate emotions from multiple faces.
        
        Args:
            face_emotions: List of emotion score dicts
            
        Returns:
            Aggregated emotion scores
        """
        if not face_emotions:
            return {label: 0.0 for label in self.emotion_labels}
        
        # Average scores across all faces
        aggregated = {label: 0.0 for label in self.emotion_labels}
        
        for emotions in face_emotions:
            for label, score in emotions.items():
                aggregated[label] += score
        
        # Normalize
        count = len(face_emotions)
        aggregated = {k: v / count for k, v in aggregated.items()}
        
        return aggregated


# Singleton instance
fer_analyzer = FERAnalyzer()


def ensure_fer_loaded():
    """Ensure FER model is loaded."""
    if not fer_analyzer._instance_initialized:
        fer_analyzer.initialize()
