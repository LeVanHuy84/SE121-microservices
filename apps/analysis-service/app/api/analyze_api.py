from collections import defaultdict
from datetime import datetime, timedelta, date
from fastapi import APIRouter, Depends, Query
from app.database.analysis_repository import AnalysisRepository
from app.database.mongo_client import engine
from app.utils.preset_mapper import resolve_preset_range, validate_range
from app.enums.emotion_enum import EmotionEnum
from app.database.models.analysis_schema import EmotionAnalysis
from app.enums.analysis_status_enum import AnalysisStatusEnum
from app.core.security import verify_internal_key


analyze_router = APIRouter(
    prefix="/emotion",
    dependencies=[Depends(verify_internal_key)]
)

repo = AnalysisRepository(engine)

@analyze_router.get("/dashboard")
async def get_community_emotion_dashboard(
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
):
    """
    Biểu đồ cảm xúc cộng đồng theo NGÀY
    - default: 7 ngày gần nhất
    - max: 30 ngày
    """

    now = datetime.now()

    # ===== DEFAULT RANGE =====
    if not to_date:
        to_date = now.date()

    if not from_date:
        from_date = to_date - timedelta(days=6)

    # ===== CLAMP RANGE =====
    MAX_DAYS = 30
    diff_days = (to_date - from_date).days + 1

    if diff_days > MAX_DAYS:
        from_date = to_date - timedelta(days=MAX_DAYS - 1)

    # convert to datetime (VN time assumed)
    start_dt = datetime.combine(from_date, datetime.min.time())
    end_dt = datetime.combine(to_date, datetime.max.time())

    # ===== QUERY DB =====
    entries = await engine.find(
        EmotionAnalysis,
        (EmotionAnalysis.createdAtVN >= start_dt) &
        (EmotionAnalysis.createdAtVN <= end_dt) &
        (EmotionAnalysis.status == AnalysisStatusEnum.SUCCESS)
    )

    # ===== GROUP BY DAY + EMOTION =====
    grouped = defaultdict(lambda: {emo.value: 0 for emo in EmotionEnum})

    for item in entries:
        if not item.finalEmotion:
            continue

        day = item.createdAtVN.strftime("%Y-%m-%d")
        emo = item.finalEmotion

        if emo in grouped[day]:
            grouped[day][emo] += 1

    # ===== FILL MISSING DAYS =====
    result = []
    current = from_date

    while current <= to_date:
        day_str = current.strftime("%Y-%m-%d")
        result.append({
            "date": day_str,
            **grouped.get(day_str, {emo.value: 0 for emo in EmotionEnum})
        })
        current += timedelta(days=1)

    return result


@analyze_router.get("/history")
async def get_history(
    userId: str,
    preset: str,
    fromDate: str = None,
    toDate: str = None,
    cursor: str = None,
    limit: int = 20
):
    try:
        start, end = resolve_preset_range(preset, fromDate, toDate)
        validate_range(start, end)
    except Exception as e:
        return {"error": str(e)}
    
    cursor_dt = None
    if cursor:
        cursor_dt = datetime.fromisoformat(cursor)

    result = await repo.get_history(
        user_id=userId,
        start=start,
        end=end,
        cursor=cursor_dt,
        limit=limit
    )

    data = [
        {
            "id": str(item.id),
            "content": item.content,
            "finalEmotion": item.finalEmotion,
            "targetType": item.targetType,
            "createdAt": item.createdAt,
            "status": item.status,
        }
        for item in result
    ]

    next_cursor = result[-1].createdAtVN if result else None

    return {
        "data": data,
        "meta": {
            "limit": limit,
            "nextCursor": next_cursor,
            "hasNextPage": len(result) == limit
        }
    }



@analyze_router.get("/summary")
async def get_summary(userId: str, preset: str, fromDate: str = None, toDate: str = None):
    try:
        start, end = resolve_preset_range(preset, fromDate, toDate)
        validate_range(start, end)
    except Exception as e:
        return {"error": str(e)}

    entries = await repo.get_all_for_summary(userId, start, end)

    counter = {}
    for e in entries:
        emo = e.finalEmotion
        if emo:
            counter[emo] = counter.get(emo, 0) + 1

    total = sum(counter.values())
    distribution = {k: v / total for k, v in counter.items()} if total else {}
    top_emotion = max(counter, key=counter.get) if total else None

    return {
        "topEmotion": top_emotion,
        "count": total,
        "distribution": distribution
    }

@analyze_router.get("/summary/daily-trend")
async def get_daily_trend(
    userId: str,
    preset: str = "week",
    fromDate: str = None,
    toDate: str = None
):
    # 1. Resolve time range
    start, end = resolve_preset_range(preset, fromDate, toDate)
    validate_range(start, end)

    # 2. DB query
    entries = await repo.get_analysis_by_date_range(
        user_id=userId,
        from_date=start,
        to_date=end
    )

    # 3. Group data theo ngày — FULL 7 EMOTIONS
    grouped = defaultdict(lambda: {emo.value: 0 for emo in EmotionEnum})

    for item in entries:
        day = item.createdAt.strftime("%Y-%m-%d")
        emo = item.finalEmotion   # joy, sadness, anger,...

        if emo in grouped[day]:
            grouped[day][emo] += 1

    # 4. Convert sang list sorted theo ngày
    response = [
        {
            "date": day,
            **grouped[day]  # inject toàn bộ 7 emotion
        }
        for day in sorted(grouped.keys())
    ]

    return response

@analyze_router.get("/summary/by-hour")
async def get_by_hour(
    userId: str
):
    # 1. Resolve thời gian tương tự các API khác
    start, end = resolve_preset_range(preset = "today")

    # 2. Query DB
    entries = await repo.get_analysis_by_date_range(
        user_id=userId,
        from_date=start,
        to_date=end
    )

    # 3. Group theo giờ (0–23), mỗi giờ có 7 cảm xúc
    grouped = defaultdict(lambda: {emo.value: 0 for emo in EmotionEnum})

    for item in entries:
        hour = item.createdAtVN.hour   # 0–23
        emo = item.finalEmotion

        if emo in grouped[hour]:
            grouped[hour][emo] += 1

    # 4. Convert sang dạng JSON key là string
    response = {
        str(hour): grouped[hour] 
        for hour in sorted(grouped.keys())
    }

    return response

@analyze_router.get("/detail/{analysisId}")
async def get_analysis_detail(analysisId: str):
    analysis = await repo.get_analysis_by_id(analysisId)
    if not analysis:
        return {"error": "Analysis not found"}

    return {
        "userId": analysis.userId,
        "targetId": analysis.targetId,
        "targetType": analysis.targetType,
        "textEmotion": analysis.textEmotion,
        "imageEmotions": analysis.imageEmotions,
        "finalEmotion": analysis.finalEmotion,
        "finalScores": analysis.finalScores,
        "status": analysis.status,
        "errorReason": analysis.errorReason,
        "createdAt": analysis.createdAt,
    }