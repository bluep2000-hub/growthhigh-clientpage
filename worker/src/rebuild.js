/**
 * 「이 기업 페이지를 다시 만들어라」 신호.
 *
 * 노션이 바뀌어도 클라이언트 페이지는 미리 만들어 둔 데이터를 보여줄 뿐이다.
 * 사람이 빌드를 돌려야 보이는데, 사람은 잊는다 — 담당자가 「고쳤는데 왜 안
 * 보이지」를 반복하게 만든 원인이 그것이다. 저장이 곧 신호가 되게 한다.
 *
 * 신호를 못 보내도 노션에는 이미 들어가 있다. 다음 빌드가 어차피 가져가므로
 * 여기서 실패해도 담당자의 저장을 실패로 돌리지 않는다.
 */

export const REBUILD_EVENT = "rebuild";

/**
 * @param {Record<string,string>} env
 * @param {string} slug
 * @returns {Promise<"sent"|"skipped"|"failed">}
 */
export async function requestRebuild(env, slug) {
  const token = env.GITHUB_DISPATCH_TOKEN;
  const repo = env.GITHUB_REPO;
  if (!token || !repo) return "skipped";

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        // GitHub 은 User-Agent 가 없으면 403 을 준다.
        "user-agent": "growthhigh-clientpage-relay",
      },
      body: JSON.stringify({
        event_type: REBUILD_EVENT,
        client_payload: { slug },
      }),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
