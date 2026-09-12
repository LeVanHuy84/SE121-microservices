import unittest

from app.utils.text_normalizer import normalize_for_guard


class TestNormalizeForGuard(unittest.TestCase):
    def test_strip_diacritics(self):
        self.assertEqual(normalize_for_guard("tự sát"), "tu sat")
        self.assertEqual(normalize_for_guard("nhảy cầu"), "nhay cau")

    def test_teencode_mapping(self):
        self.assertEqual(normalize_for_guard("tui k muon song nua"), "toi khong muon song nua")
        self.assertEqual(normalize_for_guard("mik ko thich"), "minh khong thich")
        self.assertEqual(normalize_for_guard("cai do ntn"), "cai do nhu the nao")

    def test_special_characters(self):
        self.assertEqual(normalize_for_guard("tôi muốn ch3t!!!"), "toi muon ch3t")
        self.assertEqual(normalize_for_guard("!!!?? @#"), "")

    def test_whitespace(self):
        self.assertEqual(normalize_for_guard("   k   muon  song  "), "khong muon song")

    def test_mixed_case(self):
        self.assertEqual(normalize_for_guard("TỰ SÁT"), "tu sat")

if __name__ == "__main__":
    unittest.main()
