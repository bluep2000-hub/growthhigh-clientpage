/** 창구가 그대로 상태 코드로 내보낼 수 있는 실패. 그 밖의 예외는 500 이다. */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code   화면이 분기에 쓰는 짧은 이름
   * @param {string} [detail]
   * @param {object} [extra]  응답 본문에 함께 실을 것. 거절하며 건네는 값이다
   */
  constructor(status, code, detail, extra) {
    super(detail ? `${code}: ${detail}` : code);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.extra = extra;
  }
}

export const unauthorized = (d) => new ApiError(401, "unauthorized", d);
export const notFound = (d) => new ApiError(404, "not_found", d);
/** 그 기업의 공지 밖에 있는 주소. 없는 것과 구별한다 — 저장은 없는 항목
    하나쯤은 건너뛰고 나머지를 살리지만, 남의 것이 섞여 오면 통째로 거절한다. */
export const foreign = (d) => new ApiError(404, "not_mine", d);
export const locked = (d) => new ApiError(409, "locked", d);
/** 화면이 편집 모드를 연 사이에 판이 올랐다. 지금 문서를 `current` 에 함께 준다 —
    담당자가 견주고 다시 저장한다. 화면에 적어 둔 글은 그대로 둔다. */
export const stale = (d, extra) => new ApiError(409, "stale", d, extra);
export const unprocessable = (d) => new ApiError(422, "unprocessable", d);
export const upstream = (d) => new ApiError(502, "notion_failed", d);
/** 공지 저장소가 붙어 있지 않다. 배포가 덜 된 것이라 조용히 500 으로 두지 않는다. */
export const noStore = () => new ApiError(503, "no_store", "공지 저장소가 붙어 있지 않습니다");
