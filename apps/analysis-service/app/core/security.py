from fastapi import Header, HTTPException, Depends
from app.core.config import settings

def verify_internal_key(x_internal_key: str = Header(...)):
    if x_internal_key != settings.INTERNAL_SERVICE_KEY:
        raise HTTPException(
            status_code=403,
            detail="Forbidden: Invalid internal key"
        )
