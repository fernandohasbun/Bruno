import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool, closePool } from "./pool.js";

const migrationFiles = [
  "001_initial.sql",
  "002_agent_conversations.sql",
  "003_phase_a_ops.sql",
  "004_approval_finals.sql",
  "005_persona_metrics.sql",
  "006_visibility_learning_control.sql",
  "007_out_of_office_retargets.sql"
];

async function migrate() {
  for (const file of migrationFiles) {
    const sql = await readFile(resolve("migrations", file), "utf8");
    await pool.query(sql);
    console.log(`applied ${file}`);
  }
}

migrate()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
