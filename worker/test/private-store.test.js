import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createPrivateStore } from "../src/private-store.js";
import worker from "../src/private-index.js";

// 기존 Vite는 새 Node 내장 모듈 이름을 인식하지 않아 Node 로더로 읽는다.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

// 실제 SQL·제약 조건을 SQLite에 실행한다. D1의 원자적 batch 계약도 재현한다.
function d1(sqlite) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => sqlite.prepare(sql).get(...args) || null,
            run: () => sqlite.prepare(sql).run(...args),
          };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function payload(name = "가상 검수 기업") {
  return {
    generated_at: "2026-09-18T15:30:00+09:00", company: { name }, notice: null,
    perf: null, progress: [], recommend: [], talks: [], actions: [], actions_done: 0,
    events: [], kpi: {},
  };
}

describe("분리된 고객 정상 결과 저장소", () => {
  let sqlite;
  let store;
  const save = (buildKey, startedAt, data = payload()) => store.save({
    slug: "whiffkorea", buildKey, startedAt, payload: data,
  });

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(readFileSync(new URL("../private-migrations/0001_customer_snapshots.sql", import.meta.url), "utf8"));
    sqlite.exec(readFileSync(new URL("../private-migrations/0003_private_assets.sql", import.meta.url), "utf8"));
    store = createPrivateStore({ PRIVATE_DB: d1(sqlite) });
  });
  afterEach(() => sqlite.close());

  it("새 DB 바인딩이 없으면 기존 공지 DB를 사용하지 않는다", () => {
    expect(() => createPrivateStore({ DB: d1(sqlite) })).toThrow("private_database_unavailable");
  });

  it("최초 상태는 비어 있으며 위프코리아 결과만 저장·조회한다", async () => {
    expect(await store.latest("whiffkorea")).toBeNull();
    const result = await save("job-1", 1);
    expect(result).toMatchObject({ buildKey: "job-1", startedAt: 1, payload: payload() });
    await expect(store.latest("zeroback")).rejects.toThrow("unsupported_client");
    await expect(store.save({ slug: "sample", buildKey: "job-2", startedAt: 2, payload: payload() }))
      .rejects.toThrow("unsupported_client");
    expect(() => sqlite.prepare(`INSERT INTO customer_snapshots
      (slug, build_key, source_started_at, payload, saved_at) VALUES (?, ?, ?, ?, ?)`)
      .run("zeroback", "job-3", 3, "{}", "now")).toThrow();
  });

  it("동일 실행의 재전송과 늦게 끝난 과거 실행은 최신 정상 결과를 덮어쓰지 않는다", async () => {
    await save("new", 20, payload("새 결과"));
    await save("new", 20, payload("중복 변경"));
    await save("old", 10, payload("과거 결과"));
    expect((await store.latest("whiffkorea")).payload.company.name).toBe("새 결과");
    expect(sqlite.prepare("SELECT count(*) AS n FROM customer_snapshots").get().n).toBe(2);
  });

  it("최근 정상 결과 10개만 보관한다", async () => {
    for (let n = 1; n <= 12; n += 1) await save(`job-${n}`, n);
    expect(sqlite.prepare("SELECT count(*) AS n FROM customer_snapshots").get().n).toBe(10);
    expect(sqlite.prepare("SELECT min(source_started_at) AS n FROM customer_snapshots").get().n).toBe(3);
    expect((await store.latest("whiffkorea")).buildKey).toBe("job-12");
  });

  it("잘못된·과대 결과와 비밀번호 필드는 쓰기 전에 거절하며 기존 결과를 유지한다", async () => {
    await save("good", 1);
    for (const data of [null, {}, { ...payload(), password: "가상값" },
      { ...payload(), company: { name: "가상", password: "가상값" } },
      { ...payload(), generated_at: "wrong" }, { ...payload(), talks: {} },
      { ...payload(), talks: [{pid:"internal-page"}] },
      payload("가".repeat(400000))]) {
      await expect(save("bad", 2, data)).rejects.toThrow();
    }
    for (const [key, started] of [["", 2], ["bad", -1], ["bad", 1.5]])
      await expect(save(key, started)).rejects.toThrow("invalid_snapshot_request");
    expect((await store.latest("whiffkorea")).buildKey).toBe("good");
  });

  it("이력 정리 실패 시 새 저장도 취소하며 이전 정상 결과를 유지한다", async () => {
    for (let n = 1; n <= 10; n += 1) await save(`job-${n}`, n);
    sqlite.exec(`CREATE TRIGGER fail_cleanup BEFORE DELETE ON customer_snapshots
      BEGIN SELECT RAISE(ABORT, 'cleanup failed'); END;`);
    await expect(save("job-11", 11)).rejects.toThrow("cleanup failed");
    expect((await store.latest("whiffkorea")).buildKey).toBe("job-10");
    expect(sqlite.prepare("SELECT count(*) AS n FROM customer_snapshots").get().n).toBe(10);
  });
});

describe("고객 데이터 연결 전 서버는 로그인 화면 외에 닫혀 있다", () => {
  it("위프코리아 건강 확인은 운영 준비 상태를 알리고 공용 경로는 만들지 않는다", async () => {
    const health = await worker.fetch(new Request("https://private.test/whiffkorea/health"));
    expect(await health.json()).toEqual({ status: "setup", customerReady: false });
    expect(health.headers.get("cache-control")).toBe("no-store");
    for (const path of ["/", "/health", "/c/whiffkorea.enc"]) {
      const result = await worker.fetch(new Request(`https://private.test${path}`));
      expect(result.status).toBe(404);
      expect(await result.json()).toEqual({ error: "not_found" });
    }
  });
});
