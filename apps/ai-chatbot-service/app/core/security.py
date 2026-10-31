import secrets

from fastapi import Header, HTTPException

from app.core.settings import settings


def verify_internal_key(x_internal_key: str = Header(...)):
    expected_key = settings.INTERNAL_SERVICE_KEY
    if not expected_key or not x_internal_key or not secrets.compare_digest(x_internal_key, expected_key):
        raise HTTPException(status_code=403, detail="Forbidden: Invalid internal key")

