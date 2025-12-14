from datetime import datetime, timedelta, timezone

MAX_RANGE_DAYS = 31

def validate_range(start, end):
    delta = (end - start).days
    if delta < 0:
        raise ValueError("from_date must be earlier than to_date")
    if delta > MAX_RANGE_DAYS:
        raise ValueError(f"Range too large. Maximum allowed is {MAX_RANGE_DAYS} days")


def resolve_preset_range(preset: str, from_date: str = None, to_date: str = None):
    now = datetime.now(timezone.utc)
    today = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)

    if preset == "today":
        return today, today + timedelta(days=1)

    if preset == "yesterday":
        start = today - timedelta(days=1)
        return start, today

    if preset == "last7":
        return today - timedelta(days=7), today + timedelta(days=1)

    if preset == "last30":
        return today - timedelta(days=30), today + timedelta(days=1)

    if preset == "thisWeek":
        start = today - timedelta(days=today.weekday())  # Monday
        return start, today + timedelta(days=1)

    if preset == "thisMonth":
        start = datetime(today.year, today.month, 1, tzinfo=timezone.utc)
        return start, today + timedelta(days=1)

    if preset == "custom":
        if not from_date or not to_date:
            raise ValueError("Custom preset requires from_date and to_date")

        start = datetime.fromisoformat(from_date).replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(to_date).replace(tzinfo=timezone.utc)
        return start, end

    raise ValueError("Invalid preset")
