import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

export function privateDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of ["0001_customer_snapshots.sql", "0002_auth.sql", "0003_private_assets.sql", "0004_private_rebuild_job.sql", "0005_multiple_clients.sql"])
    sqlite.exec(readFileSync(new URL(`../private-migrations/${name}`, import.meta.url), "utf8"));
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => sqlite.prepare(sql).get(...args) || null,
            run: async () => sqlite.prepare(sql).run(...args),
          };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, db };
}
