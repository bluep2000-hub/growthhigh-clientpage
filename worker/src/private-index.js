/**
 * 비공개 고객 서버의 닫힌 시작점.
 * 인증·고객용 데이터 경계 구현 전에는 어떤 기업 데이터도 전달하지 않는다.
 * 기존 중계 서버와 별도 설정으로만 실행한다.
 */
export default {
  async fetch(request) {
    const headers = { "cache-control": "no-store" };
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return Response.json({ status: "setup", customerReady: false }, { headers });
    }
    return Response.json({ error: "not_found" }, { status: 404, headers });
  },
};
