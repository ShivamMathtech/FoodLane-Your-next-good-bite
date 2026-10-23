const major = Number(process.versions.node.split(".")[0]);
if (major !== 24) {
  console.error(
    `FoodLane is tested on Node.js 24.x. You are running ${process.version}. Install Node.js 24 from https://nodejs.org/.`,
  );
  process.exit(1);
}
try {
  await import("node:sqlite");
} catch {
  console.error(
    "This Node build does not include node:sqlite. Install the official Node.js 24 distribution.",
  );
  process.exit(1);
}
