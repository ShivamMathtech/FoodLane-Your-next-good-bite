import { DatabaseSync, backup } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(resolve(root, ".env")))
  process.loadEnvFile(resolve(root, ".env"));
const source = resolve(root, process.env.DB_PATH || "data/foodlane.sqlite");
if (!existsSync(source)) {
  console.error("No database exists yet. Start the application first.");
  process.exit(1);
}
mkdirSync(resolve(root, "backups"), { recursive: true });
const file = resolve(
  root,
  "backups",
  `foodlane-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
);
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, file);
  console.log(`Backup saved: ${file}`);
} finally {
  db.close();
}
