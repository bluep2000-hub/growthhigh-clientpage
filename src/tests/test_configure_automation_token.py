import sys
import tempfile
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

from configure_automation_token import ensure_local_token  # noqa: E402


class ConfigureAutomationTokenTests(unittest.TestCase):
    def test_adds_token_without_changing_existing_values(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_bytes(b"NOTION_TOKEN=keep-this\r\nAUTOMATION_TOKEN=\r\n")

            token = ensure_local_token(path)
            saved = path.read_bytes()

            self.assertIn(b"NOTION_TOKEN=keep-this\r\n", saved)
            self.assertIn(b"AUTOMATION_TOKEN=" + token.encode("ascii"), saved)
            self.assertNotIn(b"\n", token.encode("ascii"))

    def test_reuses_existing_token(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            before = b"AUTOMATION_TOKEN=already-set\n"
            path.write_bytes(before)

            token = ensure_local_token(path)

            self.assertEqual(token, "already-set")
            self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
