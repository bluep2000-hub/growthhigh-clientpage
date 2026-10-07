import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it("신규 메인비즈·이노비즈에 갱신 비용을 표시하지 않고 갱신 프로젝트는 유지한다", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const source = html.slice(html.indexOf("  const CERT_LIB ="), html.indexOf("  const DAY ="));
  expect(source).toContain("function certLib");
  const certLib = runInNewContext(source + "\ncertLib");
  for (const [kind, amount] of [["메인비즈", "55"], ["이노비즈", "77"]]) {
    expect(certLib(kind).facts).toContainEqual(["신규 평가 비용", `${amount}만원 (VAT 포함)`]);
    expect(certLib(kind).facts.some(([key])=>key.startsWith("갱신"))).toBe(false);
    for (const suffix of ["(갱신)", " 연장"]) {
      expect(certLib(kind + suffix).facts).toContainEqual(["갱신 비용", "44만원 (VAT 포함)"]);
      expect(certLib(kind + suffix).facts.some(([key])=>key.startsWith("신규"))).toBe(false);
    }
  }
});
