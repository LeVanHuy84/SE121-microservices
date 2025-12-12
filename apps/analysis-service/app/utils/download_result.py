from dataclasses import dataclass
from typing import Optional
import numpy as np


@dataclass
class DownloadError:
    message: str
    retryable: bool


@dataclass
class DownloadResult:
    image: Optional[np.ndarray]
    error: Optional[DownloadError]

    @property
    def ok(self) -> bool:
        return self.image is not None and self.error is None
