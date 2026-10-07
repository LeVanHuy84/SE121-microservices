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
        self.assertTrue(d.is_crisis)
        self.assertEqual(d.severity, "medium")

    def test_nobody_cares_en(self) -> None:
        d = self.guard.evaluate("Nobody cares about me anyway")
        self.assertTrue(d.is_crisis)
        self.assertEqual(d.severity, "medium")

    def test_song_de_lam_gi_vi(self) -> None:
        d = self.guard.evaluate("Sống để làm gì nữa nhỉ")
        self.assertTrue(d.is_crisis)
        self.assertEqual(d.severity, "medium")

    def test_cam_thay_co_don_vi(self) -> None:
        d = self.guard.evaluate("Mình cảm thấy cô đơn quá")
        self.assertTrue(d.is_crisis)
        self.assertEqual(d.severity, "medium")

    def test_cuoc_song_vo_nghia(self) -> None:
        d = self.guard.evaluate("Cuộc sống vô nghĩa quá mình không biết tiếp tục sao")
        self.assertTrue(d.is_crisis)
        self.assertEqual(d.severity, "medium")


class TestCrisisGuard_NoCrisis(unittest.TestCase):
    """Các câu bình thường KHÔNG nên bị trigger."""

    def setUp(self) -> None:
        self.guard = CrisisGuard()

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
