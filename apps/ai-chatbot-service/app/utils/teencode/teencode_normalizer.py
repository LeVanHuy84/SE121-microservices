import json
import re
from pathlib import Path
from typing import Dict


class TeencodeNormalizer:
    """
    Teencode & Slang Normalizer using ViSoLex dictionary mapping.
    Placed in shared utils for reuse across microservice modules.
    """

    def __init__(self, dict_path: Path = None):
        if dict_path is None:
            dict_path = Path(__file__).parent / "dictionary.json"
        
        self.dictionary: Dict[str, str] = {}
        if dict_path.exists():
            with open(dict_path, "r", encoding="utf-8") as f:
                self.dictionary = json.load(f)

    def normalize(self, text: str) -> str:
        """
        Normalize teencode words using O(1) dictionary lookup.
        Preserves punctuation surrounding words.
        """
        if not text or not self.dictionary:
            return text

        words = text.split()
        normalized_words = []

        for word in words:
            # Match word boundary with Unicode awareness
            match = re.match(r"^(\W*)([\w\d_]+)(\W*)$", word, re.UNICODE)
            if match:
                prefix, core, suffix = match.groups()
                core_lower = core.lower()
                if core_lower in self.dictionary:
                    replacement = self.dictionary[core_lower]
                    if core.istitle():
                        replacement = replacement.capitalize()
                    normalized_words.append(f"{prefix}{replacement}{suffix}")
                else:
                    normalized_words.append(word)
            else:
                normalized_words.append(word)

        return " ".join(normalized_words)


teencode_normalizer = TeencodeNormalizer()
