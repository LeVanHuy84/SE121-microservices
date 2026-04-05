# app/core/dto/image_input.py
from dataclasses import dataclass

@dataclass
class ImageInput:
    url: str
    bytes: bytes
