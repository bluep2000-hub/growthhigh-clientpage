import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

import check_copies  # noqa: E402


class CopyClassificationTests(unittest.TestCase):
    def test_lf_and_crlf_are_the_same_template(self):
        state, only_root, only_copy = check_copies.classify(
            "첫 줄\r\n둘째 줄\r\n",
            "첫 줄\n둘째 줄\n",
        )

        self.assertEqual(state, check_copies.OK)
        self.assertEqual((only_root, only_copy), (0, 0))


if __name__ == "__main__":
    unittest.main()
