import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_client as b


class CalendarMatchingTests(unittest.TestCase):
    def test_company_after_meeting_prefix(self):
        for title in ['[문의]N2 담은결 - 담당자', '[문의]N3담은결 - 담당자',
                      '[메타문의]N1담은결-담당자', '[정기미팅]담은결-담당자', '[담은결] 미팅']:
            self.assertTrue(b.cal_matches(title, '담은결'), title)

    def test_other_company_and_incidental_mentions_are_excluded(self):
        for title in ['[문의]N2 담은결다른회사 - 담당자', '[문의]타기업 - 담은결 참고',
                      '담은결 관련 사내회의', '[문의]N2 다른회사 - 담당자']:
            self.assertFalse(b.cal_matches(title, '담은결'), title)

    def test_cancelled_event_is_excluded(self):
        self.assertTrue(b.cal_cancelled({'SUMMARY': '[취소][정기미팅]담은결-담당자'}))
        self.assertTrue(b.cal_cancelled({'STATUS': 'CANCELLED'}))
        self.assertFalse(b.cal_cancelled({'SUMMARY': '[문의]N2 담은결 - 담당자'}))
