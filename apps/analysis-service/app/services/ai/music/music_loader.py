"""
Music Model Loader - Singleton for music emotion regressors
- Loads valence/arousal models only
- No inference logic
"""

import logging
import os

import joblib

logger = logging.getLogger(__name__)


class MusicModelLoader:
	"""
	Music model loader (singleton-style instance).

	Responsibilities:
	- Load model_valence.pkl
	- Load model_arousal.pkl
	- Expose loaded model instances
	"""

	_instance_initialized = False

	def __init__(self):
		self.model_valence = None
		self.model_arousal = None

	def initialize(self):
		"""Load music emotion models from project model directory."""
		if self._instance_initialized:
			logger.info("[MusicModelLoader] Already initialized")
			return

		try:
			base_dir = os.path.dirname(__file__)
			# Preferred path from provided spec
			primary_model_dir = os.path.abspath(
				os.path.join(base_dir, "..", "..", "..", "model")
			)
			# Fallback path for current project layout: apps/analysis-service/model
			fallback_model_dir = os.path.abspath(
				os.path.join(base_dir, "..", "..", "..", "..", "model")
			)

			model_dir = primary_model_dir
			if not os.path.exists(os.path.join(model_dir, "model_valence.pkl")):
				model_dir = fallback_model_dir

			valence_path = os.path.join(model_dir, "model_valence.pkl")
			arousal_path = os.path.join(model_dir, "model_arousal.pkl")

			logger.info("[MusicModelLoader] Loading music emotion models...")
			self.model_valence = joblib.load(valence_path)
			self.model_arousal = joblib.load(arousal_path)

			self._instance_initialized = True
			logger.info("[MusicModelLoader] ✓ Music emotion models loaded")

		except Exception as e:
			logger.error(f"[MusicModelLoader] ✗ Failed to load models: {e}")
			raise RuntimeError(f"Music model loading failed: {e}") from e

	def is_loaded(self) -> bool:
		"""Check if both music models are loaded and ready."""
		return (
			self._instance_initialized
			and self.model_valence is not None
			and self.model_arousal is not None
		)

	def get_models(self):
		"""Return loaded (valence_model, arousal_model)."""
		if not self.is_loaded():
			raise RuntimeError("Music models not loaded. Call initialize() first.")
		return self.model_valence, self.model_arousal


music_model_loader = MusicModelLoader()


def ensure_music_model_loaded():
	"""Ensure music models are loaded (idempotent)."""
	if not music_model_loader._instance_initialized:
		music_model_loader.initialize()
