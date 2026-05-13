from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from app.services.orchestration.music_flow_service import music_flow_service
from app.core.security import verify_internal_key

music_router = APIRouter(
    prefix="/musics",
    dependencies=[Depends(verify_internal_key)]
)

class MusicUrlRequest(BaseModel):
    url: str

@music_router.post("/analyze")
async def analyze_music_from_url(req: MusicUrlRequest):
    try:
        result = music_flow_service.analyze_from_url(req.url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return {
        "success": True,
        "result": result,
    }

