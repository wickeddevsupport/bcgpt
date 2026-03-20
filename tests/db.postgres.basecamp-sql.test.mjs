import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function countPlaceholders(sql) {
  const matches = sql.match(/\$\d+/g);
  return matches ? matches.length : 0;
}

test("basecamp snapshot inserts in db.postgres keep placeholder counts aligned", () => {
  const source = fs.readFileSync(path.resolve("db.postgres.js"), "utf8");
  const targets = [
    "basecamp_project_snapshots",
    "basecamp_todo_snapshots",
    "basecamp_message_snapshots",
    "basecamp_schedule_entry_snapshots",
    "basecamp_card_snapshots",
    "basecamp_document_snapshots",
    "basecamp_person_snapshots",
    "basecamp_raw_records",
  ];

  for (const table of targets) {
    const pattern = new RegExp(
      String.raw`INSERT INTO ${table}\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)`,
      "m",
    );
    const match = source.match(pattern);
    assert.ok(match, `expected SQL insert for ${table}`);
    const columns = match[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const placeholderCount = countPlaceholders(match[2]);
    assert.equal(
      placeholderCount,
      columns.length,
      `${table} placeholder count should match listed columns`,
    );
  }
});
