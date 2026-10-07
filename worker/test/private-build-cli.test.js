import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("D1 첫 요청의 7403만 동일한 명령으로 한 번 재시도한다", async () => {
  const source = readFileSync(new URL("../scripts/build-private.mjs", import.meta.url), "utf8");
  const helper = source.slice(source.indexOf("async function runD1("), source.indexOf("async function d1("));
  const transient = {stdout: JSON.stringify({error:{code:7403}})};
  const run = vi.fn().mockRejectedValueOnce(transient).mockResolvedValueOnce({stdout:"[]"});
  const runD1 = runInNewContext(helper + "\nrunD1", {run, process:{execPath:"node"}, args:["wrangler"], cwd:"worker"});
  await runD1(["--command","SELECT slug FROM customer_credentials"]);
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[0]).toEqual(run.mock.calls[1]);
  run.mockReset().mockRejectedValue(transient);
  await expect(runD1(["--file","snapshot.sql"])).rejects.toBe(transient);
  expect(run).toHaveBeenCalledTimes(2);
  const other = {stdout:JSON.stringify({error:{code:7400}})};
  run.mockReset().mockRejectedValue(other);
  await expect(runD1(["--command","SELECT 1"])).rejects.toBe(other);
  expect(run).toHaveBeenCalledTimes(1);
});
