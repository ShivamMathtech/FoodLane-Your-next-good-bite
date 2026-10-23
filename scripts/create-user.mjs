// Local administrative CLI. Passwords are read through stdin, not process arguments.
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { openDatabase, hashPassword, id, now } from "../server/db.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(resolve(root, ".env")))
  process.loadEnvFile(resolve(root, ".env"));
const rl = createInterface({ input, output });
let db;
try {
  const name = (await rl.question("Name: ")).trim();
  const email = (await rl.question("Email: ")).trim().toLowerCase();
  const role = (await rl.question("Role (admin/driver/customer): ")).trim();
  // This operator-only tool clearly warns before showing input in the terminal.
  console.log(
    "Password entry is visible in this local terminal. Use a private terminal.",
  );
  const password = await rl.question("New password (10–128 characters): ");
  if (
    name.length < 2 ||
    name.length > 80 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !["admin", "driver", "customer"].includes(role) ||
    password.length < 10 ||
    password.length > 128
  )
    throw new Error("Invalid fields. No user was created.");
  db = openDatabase(
    resolve(root, process.env.DB_PATH || "data/foodlane.sqlite"),
    { demo: false },
  );
  if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
    throw new Error("Email already exists. No user was changed.");
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?)").run(
    id(),
    name,
    email,
    hashPassword(password),
    role,
    "",
    now(),
  );
  console.log(`Created ${role}: ${email}`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  rl.close();
  db?.close();
}
