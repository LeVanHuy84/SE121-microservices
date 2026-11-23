"""Unit tests for CrisisGuard (Story 1 - Mental Health Safety Guard)."""

from __future__ import annotations

import unittest

from app.modules.chatbot.services.guardrails import CrisisGuard


class TestCrisisGuard_ExplicitCrisis(unittest.TestCase):
    """Câu nói trực tiếp về ý định tự sát / tự làm hại."""

    def setUp(self) -> None:
        self.guard = CrisisGuard()

    def test_tu_tu_vi(self) -> None:
        d = self.guard.evaluate("Mình muốn tự tử")
        self.assertTrue(d.is_crisis)
        self.assertEqual(d.severity, "high")

    def test_muon_chet_vi(self) -> None:
        d = self.guard.evaluate("Mình muốn chết luôn cho rồi")
        self.assertTrue(d.is_crisis)
        self.assertEqual(d.severity, "high")

    def test_ket_thuc_cuoc_doi(self) -> None:
        d = self.guard.evaluate("Tôi chỉ muốn kết thúc cuộc đời")
        self.assertTrue(d.is_crisis)
        self.assertEqual(d.severity, "high")

    def test_suicide_en(self) -> None:
        d = self.guard.evaluate("I am thinking about suicide")
        self.assertTrue(d.is_crisis)
        self.assertEqual(d.severity, "high")

    def test_want_to_die_en(self) -> None:
        d = self.guard.evaluate("I just want to die")
        self.assertTrue(d.is_crisis)
        self.assertEqual(d.severity, "high")

    def test_kill_myself_en(self) -> None:
        d = self.guard.evaluate("I want to kill myself tonight")
        self.assertTrue(d.is_crisis)
        self.assertEqual(d.severity, "high")

    def test_cat_tay_vi(self) -> None:
        d = self.guard.evaluate("Mình đang cắt tay")
        self.assertTrue(d.is_crisis)
        self.assertEqual(d.severity, "high")

    def test_self_harm_en(self) -> None:
        d = self.guard.evaluate("I've been doing self harm")
        self.assertTrue(d.is_crisis)
        self.assertEqual(d.severity, "high")


class TestCrisisGuard_SoftCrisis(unittest.TestCase):
    """Câu biểu đạt tuyệt vọng mức độ cao nhưng không trực tiếp."""

    def setUp(self) -> None:
        self.guard = CrisisGuard()

    def test_life_meaningless_en(self) -> None:
        d = self.guard.evaluate("Life is meaningless to me")
        self.assertFalse(d.is_crisis)
        self.assertEqual(d.severity, "medium")

    def test_nobody_cares_en(self) -> None:
        d = self.guard.evaluate("Nobody cares about me anyway")
        self.assertFalse(d.is_crisis)
        self.assertEqual(d.severity, "medium")

    def test_song_de_lam_gi_vi(self) -> None:
        d = self.guard.evaluate("Sống để làm gì nữa nhỉ")
        self.assertFalse(d.is_crisis)
        self.assertEqual(d.severity, "medium")

    def test_cuoc_song_vo_nghia(self) -> None:
        d = self.guard.evaluate("Cuộc sống vô nghĩa quá mình không biết tiếp tục sao")
        self.assertFalse(d.is_crisis)
        self.assertEqual(d.severity, "medium")


class TestCrisisGuard_NoCrisis(unittest.TestCase):
    """Các câu bình thường KHÔNG nên bị trigger."""

    def setUp(self) -> None:
        self.guard = CrisisGuard()

    def test_cam_thay_co_don_vi(self) -> None:
        d = self.guard.evaluate("Mình cảm thấy cô đơn quá")
        self.assertFalse(d.is_crisis)
        self.assertEqual(d.severity, "none")

    def test_normal_question(self) -> None:
        d = self.guard.evaluate("Làm sao để đăng bài trên Sentimeta?")
        self.assertFalse(d.is_crisis)

    def test_greeting(self) -> None:
        d = self.guard.evaluate("Xin chào!")
        self.assertFalse(d.is_crisis)

    def test_movie_context(self) -> None:
        # "muốn" nhưng trong ngữ cảnh giải trí bình thường
        d = self.guard.evaluate("Mình muốn xem phim hành động hay")
        self.assertFalse(d.is_crisis)

    def test_chon_cua_khong_chon_chet(self) -> None:
        # Chỉ "chọn" không đủ để trigger
        d = self.guard.evaluate("Tôi muốn chọn màu sắc cho bài viết")
        self.assertFalse(d.is_crisis)

    def test_empty_string(self) -> None:
        d = self.guard.evaluate("")
        self.assertFalse(d.is_crisis)

    def test_whitespace_only(self) -> None:
        d = self.guard.evaluate("   ")
        self.assertFalse(d.is_crisis)


class TestCrisisGuard_NegatedCrisis(unittest.TestCase):
    """Phủ định khủng hoảng KHÔNG được kích hoạt crisis và trả về reason=negated_crisis."""

    def setUp(self) -> None:
        self.guard = CrisisGuard()

    def test_khong_muon_tu_tu_dau(self) -> None:
        d = self.guard.evaluate("tôi không có bị trầm cảm hay muốn tự tử đâu mà gửi hotline cho tôi")
        self.assertFalse(d.is_crisis)
        self.assertEqual(d.reason, "negated_crisis")

    def test_met_chu_khong_phai_muon_chet(self) -> None:
        d = self.guard.evaluate("áp lực mệt mỏi chứ không phải muốn chết đâu nhé")
        self.assertFalse(d.is_crisis)
        self.assertEqual(d.reason, "negated_crisis")

    def test_khong_co_y_dinh_tu_sat(self) -> None:
        d = self.guard.evaluate("mình chán đời nhưng không có ý định tự tử đâu")
        self.assertFalse(d.is_crisis)
        self.assertEqual(d.reason, "negated_crisis")

    def test_direct_negation_without_suffix(self) -> None:
        for text in (
            "tôi không muốn tự tử",
            "tôi chưa bao giờ muốn chết",
            "mình không có ý định tự sát",
            "i don't want to die",
        ):
            with self.subTest(text=text):
                d = self.guard.evaluate(text)
                self.assertFalse(d.is_crisis)
                self.assertEqual(d.reason, "negated_crisis")

    def test_real_crisis_after_earlier_negation_or_pain_not_negated(self) -> None:
        """Phủ định ở mệnh đề trước hoặc chữ 'đau' (pain -> 'dau') KHÔNG được phủ định câu tự sát thật."""
        for text in (
            "tôi không chịu nổi nữa, muốn chết",
            "tôi đau lòng quá muốn tự tử",
            "đau quá muốn chết",
            "không còn ai hiểu tôi, muốn chết",
            "không biết phải làm sao, tự tử",
            "chưa bao giờ thấy bế tắc vậy, muốn chết",
            "mình không ngủ được mấy tuần nay, muốn kết thúc cuộc đời",
        ):
            with self.subTest(text=text):
                d = self.guard.evaluate(text)
                self.assertTrue(d.is_crisis, f"Expected crisis for: {text}")
                self.assertEqual(d.severity, "high")
