import { readFileSync } from "fs";
import { join } from "path";

describe("workspace settings migration", () => {
  it("creates workspace settings table and backfills existing workspaces", () => {
    const migrationPath = join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260402090000_workspace_settings",
      "migration.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS workspace_settings/i);
    expect(sql).toMatch(/hour_format VARCHAR\(2\) NOT NULL DEFAULT '24'/i);
    expect(sql).toMatch(/default_duration_hours DOUBLE PRECISION NOT NULL DEFAULT 2/i);
    expect(sql).toMatch(/INSERT INTO workspace_settings \(workspace_id\)/i);
  });
});
