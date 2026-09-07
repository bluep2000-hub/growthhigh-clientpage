-- 공지는 기업당 하루에 한 건이다.
--
-- 같은 날짜 공지가 둘이면 클라이언트 페이지에 오르는 것이 어느 쪽인지 정할 수
-- 없고, 담당자는 화면에 뜨지 않는 공지에 적게 된다. 만들기 전에 물어보는
-- 것만으로는 담당자 둘이 같은 순간에 누르는 것을 막지 못해, 표가 직접 막는다.
--
-- 이 짝짓기가 「그 기업의 가장 최근 공지」를 찾는 길도 함께 낸다 — 앞선
-- 이름표(notices_by_slug)는 그래서 걷는다.
DROP INDEX IF EXISTS notices_by_slug;

CREATE UNIQUE INDEX IF NOT EXISTS notices_one_a_day ON notices (slug, "date");
