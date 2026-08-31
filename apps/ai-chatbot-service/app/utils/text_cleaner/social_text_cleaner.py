import re

try:
    from underthesea import text_normalize as underthesea_normalize
except ImportError:
    underthesea_normalize = None


class SocialTextCleaner:
    """
    Cleaner for social media noise: URLs, Mentions, Hashtags & Diacritics.
    Placed in shared utils for reuse.
    """

    URL_PATTERN = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
    MENTION_PATTERN = re.compile(r"@\w+", re.IGNORECASE)
    HASHTAG_PATTERN = re.compile(r"#(\w+)", re.IGNORECASE)
    WHITESPACE_PATTERN = re.compile(r"\s+")

    def clean(self, text: str, remove_url: bool = True, remove_mention: bool = True, expand_hashtag: bool = True) -> str:
        if not text:
            return ""

        # 1. Remove URLs
        if remove_url:
            text = self.URL_PATTERN.sub("", text)

        # 2. Remove @mentions
        if remove_mention:
            text = self.MENTION_PATTERN.sub("", text)

        # 3. Expand or clean #hashtags (#vui -> vui)
        if expand_hashtag:
            text = self.HASHTAG_PATTERN.sub(r"\1", text)

        # 4. Normalize Diacritics/Unicode via underthesea if available
        if underthesea_normalize is not None:
            try:
                text = underthesea_normalize(text)
            except Exception:
                pass

        # 5. Clean extra spaces
        text = self.WHITESPACE_PATTERN.sub(" ", text).strip()

        return text


social_text_cleaner = SocialTextCleaner()
