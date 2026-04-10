import json
import os
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class LiveRecommendationServiceTestCase(unittest.TestCase):
    @unittest.skipUnless(
        os.getenv("RUN_LIVE_RECOMMENDATION_TEST") == "1",
        "Set RUN_LIVE_RECOMMENDATION_TEST=1 to run live recommendation service test",
    )
    def test_live_rerank_endpoint_returns_scores(self):
        base_url = os.getenv("RECOMMENDATION_SERVICE_URL", "http://127.0.0.1:4011")
        internal_key = os.getenv(
            "INTERNAL_SERVICE_KEY",
            "recommendation-internal-key-123",
        )

        payload = {
            "viewerId": "viewer-live-test",
            "viewerProfileText": (
                "name: Vinh Co\n"
                "bio: backend engineer building social products\n"
                "location: Ho Chi Minh City\n"
                "work: Backend Engineer at Acme Social\n"
                "school: HCMUT\n"
                "interests: Công nghệ, Chạy bộ"
            ),
            "candidates": [
                {
                    "candidateId": "semantic-match",
                    "mutualFriends": 2,
                    "commonGroups": 1,
                    "candidateProfileText": (
                        "name: Minh Le\n"
                        "bio: backend engineer building platform services\n"
                        "location: Ho Chi Minh City\n"
                        "work: Platform Engineer at Social Hub\n"
                        "school: HCMUT\n"
                        "interests: Công nghệ, Chạy bộ"
                    ),
                },
                {
                    "candidateId": "semantic-mismatch",
                    "mutualFriends": 2,
                    "commonGroups": 1,
                    "candidateProfileText": (
                        "name: Hoa Tran\n"
                        "bio: accountant focused on tax and compliance\n"
                        "location: Da Nang\n"
                        "work: Accountant at Finance Hub\n"
                        "school: UEH\n"
                        "interests: Kinh doanh, Sách"
                    ),
                },
            ],
        }

        request = Request(
            url=f"{base_url}/recommend/rerank",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-internal-key": internal_key,
            },
            method="POST",
        )

        try:
            with urlopen(request, timeout=30) as response:
                body = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            self.fail(
                (
                    "Live recommendation service returned HTTP "
                    f"{error.code}: "
                    f"{error.read().decode('utf-8', errors='ignore')}"
                )
            )
        except URLError as error:
            self.fail(
                f"Could not reach live recommendation service at {base_url}: {error}"
            )

        self.assertTrue(body.get("success"))
        scores = body.get("data", {}).get("scores", [])
        self.assertEqual(len(scores), 2)

        scores_by_id = {
            str(item.get("candidateId")): float(item.get("modelScore", 0.0))
            for item in scores
        }
        self.assertIn("semantic-match", scores_by_id)
        self.assertIn("semantic-mismatch", scores_by_id)
        self.assertGreaterEqual(scores_by_id["semantic-match"], 0.0)
        self.assertLessEqual(scores_by_id["semantic-match"], 1.0)
        self.assertGreaterEqual(scores_by_id["semantic-mismatch"], 0.0)
        self.assertLessEqual(scores_by_id["semantic-mismatch"], 1.0)
        self.assertGreater(
            scores_by_id["semantic-match"],
            scores_by_id["semantic-mismatch"],
            "Live model should score the semantically closer profile higher",
        )


if __name__ == "__main__":
    unittest.main()
