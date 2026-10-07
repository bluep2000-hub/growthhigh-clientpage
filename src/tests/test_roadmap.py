import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_client as builder  # noqa: E402


def heading(kind, title):
    return {"type": kind, kind: {"rich_text": [{"plain_text": title}]}}


def row(*values):
    return {"type": "table_row", "table_row": {
        "cells": [[{"plain_text": value}] for value in values]}}


class RoadmapTests(unittest.TestCase):
    def test_latest_published_exact_company_second_material_and_manual_override(self):
        def material(pid, company, day, published=True):
            return {"id": pid, "public_url": "https://example.test" if published else None,
                    "properties": {"페이지명": {"title": [{"plain_text": f"{day} {company} - 2nd 자료"}]}}}

        sources = [material("old", "서윤웰스", "2027-01-01"),
                   material("monthly-source", "서윤웰스", "2027-02-01"),
                   material("foreign", "서윤웰스테스트", "2027-03-01"),
                   material("internal", "서윤웰스", "2027-04-01", False)]
        own_rows = [row("분야", "목적", "시작월", "종료월", "실행 항목", "표시색")]
        monthly_rows = [row("시기", "실행 항목", "주요 성과 / 산출물", "비고"),
                        row("'27년 11~12월", "(준비)\n• 자료 검토", "✅ 신청서", "• 검토 후 신청"),
                        row("'28년 1~6월", "(조달)\n• 사전 상담", "✅ 정책자금 (3~5억원)", "")]

        class Notion:
            def query_all(self, *args):
                return sources

            def children(self, pid):
                if pid == "client-page":
                    return [heading("heading_2", "컨설팅 타임테이블"), {"type": "table", "id": "own"}]
                if pid == "own":
                    return own_rows
                if pid == "monthly-source":
                    return [heading("heading_1", "진행 시나리오"),
                            heading("heading_2", "📅 주요 로드맵"), {"type": "table", "id": "monthly"},
                            heading("heading_2", "3개년 시나리오"), {"type": "table", "id": "forbidden"}]
                if pid == "monthly":
                    return monthly_rows
                raise AssertionError(f"잘못된 원본: {pid}")

        result = builder.fetch_roadmap(Notion(), "sywells", "client-page", "서윤웰스")
        self.assertEqual(result["start"], "2027-11")
        self.assertEqual([(t["segments"][0]["start"], t["segments"][0]["span"])
                          for t in result["tracks"]], [(0, 2), (2, 6)])
        self.assertIn("예상 성과 / 산출물\n정책자금 (3~5억원)", result["summaries"][1]["description"])
        monthly_rows[1] = row("'27년 0~12월", "(준비)", "", "")
        with self.assertRaisesRegex(builder.ClientFailure, "월 범위"):
            builder.fetch_roadmap(Notion(), "sywells", "client-page", "서윤웰스")
        sources.append(material("duplicate", "서윤웰스", "2027-02-01"))
        with self.assertRaisesRegex(builder.ClientFailure, "중복"):
            builder.fetch_roadmap(Notion(), "sywells", "client-page", "서윤웰스")
        own_rows.append(row("수동 계획", "합의", "2028-01", "2028-02", "진행", "blue"))
        self.assertEqual(builder.fetch_roadmap(Notion(), "sywells", "client-page", "서윤웰스")["start"],
                         "2028-01")
        own_rows.pop()
        sources.clear()
        self.assertEqual(builder.fetch_roadmap(Notion(), "sywells", "client-page", "서윤웰스")["tracks"], [])

    def test_new_client_has_empty_timetable_then_uses_its_own_months(self):
        rows = [row("분야", "목적", "시작월", "종료월", "실행 항목", "표시색")]

        class Notion:
            def children(self, block_id):
                return rows if block_id == "tracks" else [
                    heading("heading_2", "컨설팅 타임테이블"),
                    {"type": "table", "id": "tracks"}]

        empty = builder.fetch_roadmap(Notion(), "welldoneproduct", "client-page")
        self.assertEqual((empty["start"], empty["tracks"]), (None, []))
        rows.append(row("자문", "준비", "2026-11", "2027-01", "실행", "blue"))
        filled = builder.fetch_roadmap(Notion(), "welldoneproduct", "client-page")
        self.assertEqual((filled["start"], filled["tracks"][0]["segments"][0]["span"]),
                         ("2026-11", 3))

    def test_tracks_group_segments_and_preserve_year_boundary(self):
        rows = [row("분야", "목적", "시작월", "종료월", "실행 항목", "표시색"),
                row("업무", "목적", "2026-09", "2026-10", "준비", "green"),
                row("업무", "목적", "2026-12", "2027-02", "실행", "navy")]
        class Notion:
            def children(self, block_id):
                return rows if block_id == "tracks" else [
                    heading("heading_2", "컨설팅 타임테이블"),
                    {"type": "table", "id": "tracks"}]
        result = builder.fetch_track_roadmap(Notion(), "source")
        self.assertEqual(len(result["tracks"]), 1)
        self.assertEqual([(s["start"], s["span"]) for s in result["tracks"][0]["segments"]], [(0, 2), (3, 3)])
        rows[2] = row("업무", "목적", "2026-10", "2027-02", "겹침", "navy")
        with self.assertRaisesRegex(builder.ClientFailure, "겹칩니다"):
            builder.fetch_track_roadmap(Notion(), "source")
        rows[2] = row("업무", "목적", "2027-09", "2027-10", "범위 밖", "navy")
        with self.assertRaisesRegex(builder.ClientFailure, "범위"):
            builder.fetch_track_roadmap(Notion(), "source")

    def test_reads_only_monthly_plan_and_treats_checkmarks_as_expected_outputs(self):
        blocks = [heading("heading_1", "기업진단"),
                  heading("heading_1", "진행 시나리오"),
                  heading("heading_2", "📅 2026~27년 주요 로드맵"),
                  {"type": "table", "id": "monthly"},
                  heading("heading_2", "📅 3개년 시나리오"),
                  {"type": "table", "id": "long-term"}]
        rows = [row("시기", "실행 항목", "주요 성과 / 산출물", "비고"),
                row("'26년 9월", "(계약 및 서류 수취)\n• 기업서류 수취",
                    "✅ 재무 정비 계획\n✅ 벤처인증 신청 서류", "• 사업화 전략 인터뷰"),
                row("'27년 1~6월", "(정부지원사업)\n• 제작지원 검토",
                    "✅ 신청서", "• 공고 일정 확인"),
                row("'27년 2~4월", "(정책자금 조달검토)\n• 사전 상담",
                    "✅ 상담 결과", "• 재무 정비 후 검토")]

        class Notion:
            def children(self, block_id):
                return rows if block_id == "monthly" else blocks

        result = builder.fetch_roadmap(Notion(), "bowlgames")
        self.assertEqual(result["start"], "2026-09")
        self.assertEqual([(p["start"], p["span"]) for p in result["phases"]],
                         [(0, 1), (4, 6), (5, 3)])
        self.assertEqual(result["phases"][0]["outputs"],
                         ["재무 정비 계획", "벤처인증 신청 서류"])
        self.assertNotIn("3개년", str(result))
        self.assertIsNone(builder.fetch_roadmap(Notion(), "whiffkorea"))

    def test_changed_source_table_fails_instead_of_publishing_wrong_plan(self):
        class Notion:
            def children(self, block_id):
                return [row("시기", "상태", "담당", "비고")] if block_id == "monthly" else [
                    heading("heading_1", "진행 시나리오"),
                    heading("heading_2", "주요 로드맵"),
                    {"type": "table", "id": "monthly"},
                ]

        with self.assertRaisesRegex(builder.ClientFailure, "열 구성"):
            builder.fetch_roadmap(Notion(), "bowlgames")


if __name__ == "__main__":
    unittest.main()
