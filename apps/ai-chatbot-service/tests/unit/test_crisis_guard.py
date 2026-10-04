"""Unit tests for CrisisGuard (Story 1 - Mental Health Safety Guard)."""
from __future__ import annotations

import pytest

from app.modules.chatbot.services.guardrails import CrisisGuard


@pytest.fixture
def guard() -> CrisisGuard:
    return CrisisGuard()


class TestCrisisGuard_ExplicitCrisis:
    """Câu nói trực tiếp về ý định tự sát / tự làm hại."""

    def test_tu_tu_vi(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("Mình muốn tự tử")
        assert d.is_crisis is True
        assert d.severity == "high"

    def test_muon_chet_vi(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("Mình muốn chết luôn cho rồi")
        assert d.is_crisis is True
        assert d.severity == "high"

    def test_ket_thuc_cuoc_doi(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("Tôi chỉ muốn kết thúc cuộc đời")
        assert d.is_crisis is True
        assert d.severity == "high"

    def test_suicide_en(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("I am thinking about suicide")
        assert d.is_crisis is True
        assert d.severity == "high"

    def test_want_to_die_en(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("I just want to die")
        assert d.is_crisis is True
        assert d.severity == "high"

    def test_kill_myself_en(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("I want to kill myself tonight")
        assert d.is_crisis is True
        assert d.severity == "high"

    def test_cat_tay_vi(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("Mình đang cắt tay")
        assert d.is_crisis is True
        assert d.severity == "high"

    def test_self_harm_en(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("I've been doing self harm")
        assert d.is_crisis is True
        assert d.severity == "high"


class TestCrisisGuard_SoftCrisis:
    """Câu biểu đạt tuyệt vọng mức độ cao nhưng không trực tiếp."""

    def test_life_meaningless_en(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("Life is meaningless to me")
        assert d.is_crisis is True
        assert d.severity == "medium"

    def test_nobody_cares_en(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("Nobody cares about me anyway")
        assert d.is_crisis is True
        assert d.severity == "medium"

    def test_song_de_lam_gi_vi(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("Sống để làm gì nữa nhỉ")
        assert d.is_crisis is True
        assert d.severity == "medium"

    def test_cam_thay_co_don_vi(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("Mình cảm thấy cô đơn quá")
        assert d.is_crisis is True
        assert d.severity == "medium"

    def test_cuoc_song_vo_nghia(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("Cuộc sống vô nghĩa quá mình không biết tiếp tục sao")
        assert d.is_crisis is True
        assert d.severity == "medium"


class TestCrisisGuard_NoCrisis:
    """Các câu bình thường KHÔNG nên bị trigger."""

    def test_normal_question(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("Làm sao để đăng bài trên Sentimeta?")
        assert d.is_crisis is False

    def test_greeting(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("Xin chào!")
        assert d.is_crisis is False

    def test_movie_context(self, guard: CrisisGuard) -> None:
        # "muốn" nhưng trong ngữ cảnh giải trí bình thường
        d = guard.evaluate("Mình muốn xem phim hành động hay")
        assert d.is_crisis is False

    def test_chon_cua_khong_chon_chet(self, guard: CrisisGuard) -> None:
        # Chỉ "chọn" không đủ để trigger
        d = guard.evaluate("Tôi muốn chọn màu sắc cho bài viết")
        assert d.is_crisis is False

    def test_empty_string(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("")
        assert d.is_crisis is False

    def test_whitespace_only(self, guard: CrisisGuard) -> None:
        d = guard.evaluate("   ")
        assert d.is_crisis is False
