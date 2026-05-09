import os
import unittest

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")

from app.schemas.assistant_schema import AssistantRespondRequest
from app.services.scope_guard import AssistantScopeGuard


class ScopeGuardRealQuestionTest(unittest.TestCase):
    def setUp(self):
        self.guard = AssistantScopeGuard()

    def test_in_scope_questions(self):
        samples = [
            "Ban la ai?",
            "Ban lam duoc gi?",
            "Ban con nho noi dung truoc do khong?",
            "Cach dang bai viet moi tren bang tin?",
            "Tim giup toi nhom cong dong ve startup",
            "Lam sao de ket ban voi user nay?",
            "Vi sao chat inbox khong realtime?",
            "Huong dan sua quyen rieng tu ho so",
            "Xem thong bao moi nhat o dau?",
            "Phan tich cam xuc cua bai dang nay",
            "Tra cuu profile cua ban toi",
            "Goi y ket ban theo so thich",
            "Cach tham gia nhom kin",
            "How can I search posts in Sentimeta?",
            "How do I update my profile privacy settings?",
            "Why are chat messages not real-time?",
            "tim giup toi bai viet ve startup",
            "Tìm giúp tôi bài viết về startup",
            "hướng dẫn tui chỉnh quyền riêng tư profile nha",
            "cho tui hỏi cách vào nhóm kín với",
        ]
        for message in samples:
            with self.subTest(message=message):
                req = AssistantRespondRequest(userId="u1", message=message)
                self.assertTrue(self.guard.is_in_scope(req))

    def test_follow_up_question_is_in_scope_when_has_conversation_context(self):
        req = AssistantRespondRequest(
            userId="u1",
            message="Cach dung chuc nang tren?",
            history=[
                {
                    "role": "user",
                    "content": "Goi y ban be la gi?",
                },
                {
                    "role": "assistant",
                    "content": "Do la tinh nang de de xuat ban be phu hop.",
                },
            ],
        )
        self.assertTrue(
            self.guard.is_in_scope(
                req,
                last_intent="user",
                recent_history=req.history,
            )
        )

    def test_strong_reference_follow_up_is_in_scope_without_anchor(self):
        samples = [
            "Cach dung chuc nang tren?",
            "Phan do dung sao?",
            "Muc nay la gi?",
            "That section how to use?",
        ]
        for message in samples:
            with self.subTest(message=message):
                req = AssistantRespondRequest(
                    userId="u1",
                    message=message,
                )
                self.assertTrue(self.guard.is_in_scope(req))

    def test_generic_how_to_without_domain_anchor_is_out_of_scope(self):
        req = AssistantRespondRequest(
            userId="u1",
            message="Cach dung quicksort nhu the nao?",
        )
        self.assertFalse(self.guard.is_in_scope(req))

    def test_pronoun_follow_up_needs_anchor(self):
        without_anchor = AssistantRespondRequest(
            userId="u1",
            message="No la gi?",
        )
        self.assertFalse(self.guard.is_in_scope(without_anchor))

        with_anchor = AssistantRespondRequest(
            userId="u1",
            message="No la gi?",
            history=[
                {
                    "role": "user",
                    "content": "Goi y ban be la gi?",
                }
            ],
        )
        self.assertTrue(
            self.guard.is_in_scope(
                with_anchor,
                last_intent="user",
                recent_history=with_anchor.history,
            )
        )

    def test_pronoun_follow_up_variants_are_in_scope_with_anchor(self):
        samples = [
            "No nhu the nao?",
            "No hoat dong sao?",
            "Dung no nhu the nao?",
            "Su dung no sao?",
            "Huong dan dung no",
            "Giai thich them ve no",
            "Noi ro hon phan do",
            "Cho vi du cu the",
            "What next?",
            "Can you explain more?",
        ]
        for message in samples:
            with self.subTest(message=message):
                req = AssistantRespondRequest(
                    userId="u1",
                    message=message,
                    history=[
                        {
                            "role": "user",
                            "content": "Goi y ban be la gi?",
                        },
                        {
                            "role": "assistant",
                            "content": "Do la tinh nang de de xuat ban be.",
                        },
                    ],
                )
                self.assertTrue(
                    self.guard.is_in_scope(
                        req,
                        last_intent="user",
                        recent_history=req.history,
                    )
                )

    def test_out_of_scope_questions(self):
        samples = [
            "Thoi tiet hom nay the nao?",
            "Gia vang hien tai bao nhieu?",
            "Viet code sap xep quicksort giup toi",
            "Dat ve may bay di Da Nang",
            "Giai thich co che blockchain",
            "Dich cau nay sang tieng Nhat",
            "Lich thi dau bong da toi nay",
            "Cong thuc nau bo kho",
            "Mua laptop nao cho dan backend",
            "Tom tat phim Interstellar",
            "dịch giúp tui cv sang tiếng anh chuẩn ats",
            "kể mình nghe chuyện ma đi",
        ]
        for message in samples:
            with self.subTest(message=message):
                req = AssistantRespondRequest(userId="u1", message=message)
                self.assertFalse(self.guard.is_in_scope(req))

    def test_multi_intent_question_with_sentimeta_anchor_is_in_scope(self):
        req = AssistantRespondRequest(
            userId="u1",
            message="Vừa cách đăng bài vừa cách tìm nhóm trong Sentimeta là gì?",
        )
        self.assertTrue(self.guard.is_in_scope(req))

    def test_follow_up_contextual_question_is_in_scope(self):
        req = AssistantRespondRequest(
            userId="u1",
            message="còn bước tiếp theo thì sao?",
            history=[
                {"role": "user", "content": "Cách bật quyền riêng tư hồ sơ?"},
                {"role": "assistant", "content": "Bạn vào Cài đặt > Quyền riêng tư..."},
            ],
        )
        self.assertTrue(
            self.guard.is_in_scope(
                req,
                last_intent="user",
                recent_history=req.history,
            )
        )


if __name__ == "__main__":
    unittest.main()
