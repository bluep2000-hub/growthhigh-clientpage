/** 창구가 그대로 상태 코드로 내보낼 수 있는 실패. 그 밖의 예외는 500 이다. */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code   화면이 분기에 쓰는 짧은 이름
   * @param {string} [detail]
   */
  constructor(status, code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const unauthorized = (d) => new ApiError(401, "unauthorized", d);
export const notFound = (d) => new ApiError(404, "not_found", d);
/** 그 기업의 공지 밖에 있는 주소. 없는 것과 구별한다 — 저장은 없는 항목
    하나쯤은 건너뛰고 나머지를 살리지만, 남의 것이 섞여 오면 통째로 거절한다. */
export const foreign = (d) => new ApiError(404, "not_mine", d);
export const locked = (d) => new ApiError(409, "locked", d);
export const unprocessable = (d) => new ApiError(422, "unprocessable", d);
export const upstream = (d) => new ApiError(502, "notion_failed", d);
