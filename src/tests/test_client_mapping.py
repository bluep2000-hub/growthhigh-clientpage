import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))

from client_mapping import UnknownCompanyError, client_slug_for  # noqa: E402


class ClientMappingTests(unittest.TestCase):
    def test_whiffkorea_folder_maps_to_page_slug(self):
        self.assertEqual(client_slug_for("위프코리아"), "whiffkorea")

    def test_surrounding_spaces_are_ignored(self):
        self.assertEqual(client_slug_for("  위프코리아  "), "whiffkorea")

    def test_unknown_company_fails_closed(self):
        with self.assertRaisesRegex(UnknownCompanyError, "등록되지 않은 고객사"):
            client_slug_for("위프 코리아")


if __name__ == "__main__":
    unittest.main()
