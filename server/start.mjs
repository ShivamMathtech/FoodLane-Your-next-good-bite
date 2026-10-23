import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { openDatabase } from "./db.mjs";
import { createApp } from "./app.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(resolve(root, ".env")))
  process.loadEnvFile(resolve(root, ".env"));
const demo = process.env.DEMO_MODE !== "false";
if (!existsSync(resolve(root, "dist/index.html"))) {
  console.error(
    "Frontend build not found. Run npm install then npm run build.",
  );
  process.exit(1);
}
const db = openDatabase(
  resolve(root, process.env.DB_PATH || "data/foodlane.sqlite"),
  { demo },
);
if (
  !demo &&
  db
    .prepare(
      "SELECT id FROM users WHERE id IN ('customer-demo','admin-demo','driver-demo')",
    )
    .get()
) {
  console.error(
    "DEMO_MODE=false requires a fresh database without seeded demo accounts. Set DB_PATH to a new filename; create staff with the CLI.",
  );
  db.close();
  process.exit(1);
}
const server = createApp({
  db,
  publicDir: resolve(root, "dist"),
  demo,
  secureCookies: process.env.SECURE_COOKIES === "true",
  appOrigin: process.env.APP_ORIGIN || "",
});
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const port = Number(flag("--port") || process.env.PORT || 3000),
  host = flag("--host") || process.env.HOST || "127.0.0.1";
server.listen(port, host, () =>
  console.log(
    `\nFoodLane is running at http://localhost:${port}\nMode: ${demo ? "local demo (seeded accounts, demo payment/tracking enabled)" : "standard (cash on delivery)"}\nPress Ctrl+C to stop.\n`,
  ),
);
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Stop the other app or set PORT in .env.`
      : e.message,
  );
  db.close();
  process.exitCode = 1;
});
function stop() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
