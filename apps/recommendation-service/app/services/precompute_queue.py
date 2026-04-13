from __future__ import annotations

from threading import RLock


class RecommendationPrecomputeQueue:
    def __init__(self):
        self._lock = RLock()
        self._pending_viewer_ids: set[str] = set()
        self._projection_rows_changed = 0

    def mark_stale(self, viewer_id: str):
        normalized_viewer_id = str(viewer_id or "").strip()
        if not normalized_viewer_id:
            return

        with self._lock:
            self._pending_viewer_ids.add(normalized_viewer_id)

    def mark_many(self, viewer_ids: list[str] | set[str] | tuple[str, ...]):
        for viewer_id in viewer_ids:
            self.mark_stale(viewer_id)

    def drain(self, limit: int) -> list[str]:
        resolved_limit = max(1, int(limit))

        with self._lock:
            selected_viewer_ids = sorted(self._pending_viewer_ids)[:resolved_limit]
            for viewer_id in selected_viewer_ids:
                self._pending_viewer_ids.discard(viewer_id)

        return selected_viewer_ids

    def size(self) -> int:
        with self._lock:
            return len(self._pending_viewer_ids)

    def record_projection_rows_changed(self, rows_changed: int):
        resolved_rows_changed = max(0, int(rows_changed))
        if resolved_rows_changed <= 0:
            return

        with self._lock:
            self._projection_rows_changed += resolved_rows_changed

    def consume_projection_rows_changed(self) -> int:
        with self._lock:
            rows_changed = self._projection_rows_changed
            self._projection_rows_changed = 0
            return rows_changed


precompute_queue = RecommendationPrecomputeQueue()
