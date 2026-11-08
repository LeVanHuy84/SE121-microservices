"""Google Gemini API client for LLM-as-a-Judge Evaluation Engine.

Uses Google Generative Language REST API with structured JSON output.
Reads GEMINI_API (or GEMINI_API_KEY) and GEMINI_MODEL_NAME from evaluation/.env.
"""

import json
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
from dotenv import load_dotenv

CURRENT_DIR = Path(__file__).resolve().parent
EVAL_DIR = CURRENT_DIR.parent.parent
load_dotenv(EVAL_DIR / ".env")
load_dotenv()


class GeminiJudgeClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        timeout: float = 45.0,
    ):
        self.api_key = api_key or os.getenv("GEMINI_API") or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "Missing GEMINI_API key! Please define GEMINI_API in evaluation/.env"
            )

        self.model_name = (
            model_name
            or os.getenv("GEMINI_MODEL_NAME")
            or "gemini-3.5-flash"
        ).strip()
        self.timeout = timeout
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models"

    def generate_json_judgment(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        max_retries: int = 3,
    ) -> Dict[str, Any]:
        """Calls Gemini API with strict JSON output configuration and retry backoff."""
        url = f"{self.base_url}/{self.model_name}:generateContent?key={self.api_key}"

        payload: Dict[str, Any] = {
            "contents": [
                {
                    "parts": [{"text": prompt}]
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.1,
                "maxOutputTokens": 3000,
            },
        }

        if system_instruction:
            payload["systemInstruction"] = {
                "parts": [{"text": system_instruction}]
            }

        last_error = ""
        with httpx.Client(trust_env=False, timeout=self.timeout) as client:
            for attempt in range(1, max_retries + 1):
                start_time = time.perf_counter()
                try:
                    response = client.post(url, json=payload)
                    latency_ms = (time.perf_counter() - start_time) * 1000

                    if response.status_code == 200:
                        res_data = response.json()
                        candidates = res_data.get("candidates", [])
                        if not candidates:
                            raise ValueError(f"No candidates returned: {res_data}")

                        part = candidates[0].get("content", {}).get("parts", [{}])[0]
                        text_content = part.get("text", "").strip()

                        # Parse JSON from model
                        parsed = json.loads(text_content)
                        parsed["_meta"] = {
                            "judge_model": self.model_name,
                            "latency_ms": round(latency_ms, 2),
                            "timestamp": time.time(),
                        }
                        return parsed

                    # Rate Limit (429) backoff
                    if response.status_code == 429:
                        wait_sec = 6.0 * attempt
                        print(f"[Gemini 429 RateLimit, waiting {wait_sec:.0f}s...]", end=" ", flush=True)
                        time.sleep(wait_sec)
                        continue

                    # Server error backoff
                    if response.status_code in (500, 502, 503, 504) and attempt < max_retries:
                        wait_sec = 3.0 * attempt
                        print(f"[Gemini {response.status_code} Err, waiting {wait_sec:.0f}s...]", end=" ", flush=True)
                        time.sleep(wait_sec)
                        continue

                    last_error = f"[HTTP {response.status_code}] {response.text[:300]}"

                except json.JSONDecodeError as jde:
                    last_error = f"JSON parse error from model: {str(jde)}"
                except Exception as exc:
                    last_error = f"Request exception: {str(exc)}"
                    if attempt < max_retries:
                        time.sleep(2.0 * attempt)

        raise RuntimeError(f"Gemini Judge call failed after {max_retries} attempts: {last_error}")
