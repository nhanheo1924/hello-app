import { readFileSync } from "fs";
import { join } from "path";

describe("phase1-2 migration backfill", () => {
  it("contains updated_by_user_id backfill and project settings seed", () => {
    const migrationPath = join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260326103000_phase1_phase2_core",
      "migration.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/SET owner_user_id = created_by_user_id/i);
    expect(sql).toMatch(/SET updated_by_user_id = created_by_user_id/i);
    expect(sql).toMatch(/INSERT INTO project_settings/i);
    expect(sql).toMatch(
      /SET completed_at = COALESCE\(completed_at, updated_at\)/i,
    );
  });
});
