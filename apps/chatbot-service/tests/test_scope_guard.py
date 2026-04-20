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
        ]
        for message in samples:
            with self.subTest(message=message):
                req = AssistantRespondRequest(userId="u1", message=message)
                self.assertTrue(self.guard.is_in_scope(req))

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
        ]
        for message in samples:
            with self.subTest(message=message):
                req = AssistantRespondRequest(userId="u1", message=message)
                self.assertFalse(self.guard.is_in_scope(req))


if __name__ == "__main__":
    unittest.main()
