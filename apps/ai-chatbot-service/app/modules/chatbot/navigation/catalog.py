from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

_ID_PATTERN = re.compile(r"^[a-z]+(\.[a-z_]+)*$")
_DEFAULT_YAML_PATH = Path(__file__).resolve().parent / "destinations.yaml"


@dataclass(frozen=True, slots=True)
class DestinationEntry:
    id: str
    label_vi: str
    description: str
    synonyms: tuple[str, ...]
    help_doc_ids: tuple[str, ...]
    params: dict[str, str] = field(default_factory=dict)


class DestinationCatalog:
    """Loads and validates navigation destinations from YAML config."""

    def __init__(self, yaml_path: Path | str | None = None):
        self._path = Path(yaml_path) if yaml_path else _DEFAULT_YAML_PATH
        self._destinations: dict[str, DestinationEntry] = {}
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            raise FileNotFoundError(f"Destination catalog not found: {self._path}")

        with open(self._path, encoding="utf-8") as f:
            raw_data = yaml.safe_load(f)

        raw_items = raw_data.get("destinations") if isinstance(raw_data, dict) else None
        if not isinstance(raw_items, list):
            raise ValueError("destinations.yaml must contain a top-level 'destinations' list")

        for index, item in enumerate(raw_items):
            if not isinstance(item, dict):
                raise ValueError(f"Destination item at index {index} is not a dictionary")

            dest_id = item.get("id")
            if not dest_id or not isinstance(dest_id, str):
                raise ValueError(f"Destination at index {index} missing valid 'id'")

            if not _ID_PATTERN.match(dest_id):
                raise ValueError(
                    f"Destination id '{dest_id}' does not match pattern ^[a-z]+(\\.[a-z_]+)*$"
                )

            label_vi = item.get("labelVi", "").strip()
            if not label_vi or len(label_vi) > 40:
                raise ValueError(
                    f"Destination '{dest_id}' labelVi must be 1-40 chars, got: '{label_vi}'"
                )

            description = item.get("description", "").strip()
            raw_synonyms = item.get("synonyms") or []
            if not isinstance(raw_synonyms, list) or not raw_synonyms:
                raise ValueError(f"Destination '{dest_id}' must have at least one synonym")

            synonyms = tuple(str(s).strip() for s in raw_synonyms if str(s).strip())
            help_doc_ids = tuple(item.get("helpDocIds") or ())
            params = item.get("params") or {}

            entry = DestinationEntry(
                id=dest_id,
                label_vi=label_vi,
                description=description,
                synonyms=synonyms,
                help_doc_ids=help_doc_ids,
                params=params,
            )
            self._destinations[dest_id] = entry

    def get(self, destination_id: str) -> DestinationEntry | None:
        return self._destinations.get(destination_id)

    def all_destinations(self) -> list[DestinationEntry]:
        return list(self._destinations.values())

    def __len__(self) -> int:
        return len(self._destinations)

    def __contains__(self, destination_id: str) -> bool:
        return destination_id in self._destinations


destination_catalog = DestinationCatalog()
