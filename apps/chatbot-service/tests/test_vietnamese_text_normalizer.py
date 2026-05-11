import unittest

from app.utils.text_normalizer import normalize_query_text, normalize_text


class VietnameseTextNormalizerTest(unittest.TestCase):
    def test_normalize_text_nfc(self):
        decomposed = "Ho\u0300a bi\u0300nh va\u0300 pha\u0301t trie\u0302\u0309n"
        normalized = normalize_text(decomposed)
        self.assertEqual(normalized, "Hòa bình và phát triển")

    def test_normalize_query_text(self):
        value = "  TÌM   KIẾM   BÀI  viết  "
        normalized = normalize_query_text(value)
        self.assertEqual(normalized, "tìm kiếm bài viết")


if __name__ == "__main__":
    unittest.main()

