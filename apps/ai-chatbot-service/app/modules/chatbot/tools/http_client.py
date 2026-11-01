from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.settings import settings

logger = logging.getLogger("uvicorn.error")


class GatewayHttpClient:
    """Async HTTP client with connection pooling and circuit breakers for downstream microservices.

    Communicates with api-gateway using internal HTTP keep-alive.
    """

    def __init__(
        self,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
        client: httpx.AsyncClient | None = None,
    ):
        self.base_url = (base_url or settings.API_GATEWAY_URL).rstrip("/")
        self.timeout = timeout_seconds or settings.TOOL_HTTP_TIMEOUT_SECONDS
        self._external_client = client is not None
        self._client = client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout,
            limits=httpx.Limits(
                max_keepalive_connections=20,
                max_connections=50,
                keepalive_expiry=30.0,
            ),
        )

    async def get(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        auth_token: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        req_headers = {
            "Accept": "application/json",
            "x-internal-key": settings.INTERNAL_SERVICE_KEY,
        }
        if headers:
            req_headers.update(headers)
        if auth_token:
            clean_token = auth_token.strip()
            if clean_token.lower().startswith("bearer "):
                clean_token = clean_token[7:].strip()
            req_headers["Authorization"] = f"Bearer {clean_token}"

        try:
            response = await self._client.get(
                path,
                params=params,
                headers=req_headers,
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json()
            # If standard NestJS envelope { success: true, data: ... }, unwrap data
            if isinstance(data, dict) and "data" in data and "success" in data:
                return data["data"]
            return data
        except httpx.TimeoutException:
            logger.warning("Gateway call to %s timed out after %.2fs", path, self.timeout)
            return {
                "_error": "timeout",
                "message": "Dịch vụ phản hồi quá thời gian quy định.",
            }
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Gateway call to %s failed with status %d: %s",
                path,
                exc.response.status_code,
                exc.response.text[:200],
            )
            return {
                "_error": f"http_{exc.response.status_code}",
                "status": exc.response.status_code,
                "message": "Không thể lấy thông tin từ dịch vụ vào lúc này.",
            }
        except httpx.RequestError as exc:
            logger.warning("Gateway call to %s connection error: %s", path, exc)
            return {
                "_error": "connection_error",
                "message": "Lỗi kết nối tới dịch vụ nội bộ.",
            }
        except Exception as exc:
            logger.exception("Unexpected error calling gateway %s: %s", path, exc)
            return {
                "_error": "unexpected_error",
                "message": str(exc),
            }

    async def close(self) -> None:
        if not self._external_client and not self._client.is_closed:
            await self._client.aclose()


gateway_http_client = GatewayHttpClient()
