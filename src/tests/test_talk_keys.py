import hashlib
import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

import build_client as builder  # noqa: E402


class TalkKeyTests(unittest.TestCase):
    def test_key_is_first_24_hex_digits_of_sha256(self):
        page_id = "11111111-2222-3333-4444-555555555555"
        expected = hashlib.sha256(page_id.encode("utf-8")).hexdigest()[:24]

        self.assertEqual(builder.talk_key(page_id), expected)
        self.assertRegex(builder.talk_key(page_id), r"^[0-9a-f]{24}$")

    def test_public_talk_keeps_key_but_removes_private_page_id_and_actions(self):
        public = builder.public_talk({
            "title": "9월 정기 미팅",
            "major": True,
            "talk_key": "0123456789abcdef01234567",
            "pid": "11111111-2222-3333-4444-555555555555",
            "actions": [{"item": "자료 전달"}],
        })

        self.assertEqual(public["talk_key"], "0123456789abcdef01234567")
        self.assertNotIn("pid", public)
        self.assertNotIn("actions", public)


if __name__ == "__main__":
    unittest.main()
