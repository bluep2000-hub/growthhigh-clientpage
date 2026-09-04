/**
 * 클라이언트 페이지의 편집 모드가 노션에 쓸 때 거치는 중계 서버.
 *
 * 노션 토큰은 이 서버 안에만 있다. 클라이언트 페이지는 주소만 알면 누구나
 * 열리므로, 화면 쪽에 토큰을 두면 워크스페이스 전체가 새어 나간다.
 *
 * 지금은 살아 있는지 확인하는 창구 하나뿐이다. 공지 항목을 고치고 보태고
 * 지우는 창구는 다음 티켓에서 붙는다.
 */

const HEALTH_PATH = "/health";

/** JSON 응답 하나. 창구가 늘어도 모양이 갈라지지 않게 여기로 모은다. */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string, string>} env
   */
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === HEALTH_PATH && request.method === "GET") {
      return json({ ok: true, service: "growthhigh-clientpage-relay" });
    }

    return json({ error: "not_found" }, 404);
  },
};
