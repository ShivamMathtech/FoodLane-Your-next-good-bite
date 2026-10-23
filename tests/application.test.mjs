import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../server/db.mjs";
import { createApp } from "../server/app.mjs";

async function fixture(t, { demo = true } = {}) {
  const db = openDatabase(":memory:");
  const server = createApp({
    db,
    publicDir: resolve("dist"),
    demo,
    logger: {
      error: (e) => {
        throw e;
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
  });
  function client() {
    let cookie = "";
    return async (
      path,
      { method = "GET", body, expect = 200, headers = {} } = {},
    ) => {
      const response = await fetch(base + "/api" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-FoodLane": "1",
          cookie,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const sc = response.headers.get("set-cookie");
      if (sc) cookie = sc.split(";")[0];
      const data = await response.json();
      assert.equal(
        response.status,
        expect,
        `${method} ${path}: ${JSON.stringify(data)}`,
      );
      return data;
    };
  }
  const customer = client(),
    admin = client(),
    driver = client();
  await customer("/auth/login", {
    method: "POST",
    body: { email: "customer@foodlane.local", password: "Customer123!" },
  });
  await admin("/auth/login", {
    method: "POST",
    body: { email: "admin@foodlane.local", password: "Admin123!" },
  });
  await driver("/auth/login", {
    method: "POST",
    body: { email: "driver@foodlane.local", password: "Driver123!" },
  });
  const add = (options = {}) =>
    customer("/cart", {
      method: "POST",
      body: {
        menu_id: "burger-classic",
        quantity: 1,
        size: "regular",
        sauce: "none",
        ...options,
      },
    });
  const order = (options = {}) =>
    customer("/orders", {
      method: "POST",
      body: {
        address_id: "demo-home",
        payment_method: "cod",
        idempotency_key: randomUUID(),
        ...options,
      },
    });
  return { db, server, base, client, customer, admin, driver, add, order };
}

test("full customer → kitchen → driver lifecycle, chat, review and reporting", async (t) => {
  const { customer, admin, driver, add, order } = await fixture(t);
  await add({ quantity: 2, size: "large", sauce: "garlic" });
  const q = await customer("/cart/quote", {
    method: "POST",
    body: { coupon: "WELCOME20" },
  });
  assert.equal(q.subtotal_cents, 68800);
  assert.equal(q.discount_cents, 13760);
  assert.equal(q.delivery_cents, 0);
  assert.equal(q.total_cents, 56540);
  let { order: o } = await order({ coupon: "WELCOME20", total_cents: 1 });
  assert.equal(o.total_cents, 56540);
  assert.equal((await customer("/cart")).items.length, 0);
  await customer(`/orders/${o.id}/messages`, {
    method: "POST",
    body: { body: "Please ring the bell." },
  });
  await admin(`/orders/${o.id}/messages`, {
    method: "POST",
    body: { body: "Noted, thank you!" },
  });
  assert.equal((await customer(`/orders/${o.id}/messages`)).messages.length, 2);
  for (const status of ["accepted", "preparing", "ready"])
    await admin(`/orders/${o.id}/status`, {
      method: "PATCH",
      body: { status },
    });
  await admin(`/admin/orders/${o.id}/driver`, {
    method: "PATCH",
    body: { driver_id: "driver-demo" },
  });
  assert.equal((await driver("/orders")).orders.length, 1);
  await driver(`/orders/${o.id}/status`, {
    method: "PATCH",
    body: { status: "out_for_delivery" },
  });
  o = (
    await driver(`/orders/${o.id}/status`, {
      method: "PATCH",
      body: { status: "delivered" },
    })
  ).order;
  assert.equal(o.events.length, 6);
  assert.equal(o.payment_status, "collected");
  await customer(`/orders/${o.id}/review`, {
    method: "POST",
    body: { rating: 5, driver_rating: 4, body: "A delicious meal." },
  });
  assert.equal((await customer("/restaurants/ember")).reviews[0].rating, 5);
  assert.equal((await admin("/admin/stats")).stats.revenue_cents, 56540);
});

test("ownership and staff permissions protect orders, addresses, chat and admin tools", async (t) => {
  const { client, customer, driver, add, order } = await fixture(t);
  await add();
  const { order: o } = await order();
  const stranger = client();
  await stranger("/auth/register", {
    method: "POST",
    body: {
      name: "Other Customer",
      email: "other@example.test",
      password: "OtherPassword123!",
    },
  });
  for (const path of [`/orders/${o.id}`, `/orders/${o.id}/messages`])
    await stranger(path, { expect: 403 });
  await stranger(`/orders/${o.id}/cancel`, {
    method: "POST",
    body: {},
    expect: 403,
  });
  await stranger("/addresses/demo-home", {
    method: "PATCH",
    body: {
      label: "Home",
      recipient: "Other",
      phone: "9000000000",
      line1: "123 sample street",
      city: "City",
      postcode: "123456",
    },
    expect: 404,
  });
  await driver(`/orders/${o.id}`, { expect: 403 });
  await customer("/admin/stats", { expect: 403 });
  await customer(`/orders/${o.id}/status`, {
    method: "PATCH",
    body: { status: "delivered" },
    expect: 403,
  });
  await customer("/admin/menu/burger-classic", {
    method: "PATCH",
    body: { price_cents: 1 },
    expect: 403,
  });
});

test("checkout is idempotent and prices are always recomputed on the server", async (t) => {
  const { customer, admin, add, order } = await fixture(t);
  await add();
  await admin("/admin/menu/burger-classic", {
    method: "PATCH",
    body: { price_cents: 30000 },
  });
  const key = randomUUID(),
    a = await order({ idempotency_key: key, total_cents: 1 }),
    b = await order({ idempotency_key: key, total_cents: 1 });
  assert.equal(a.order.id, b.order.id);
  assert.equal(a.order.total_cents, 35400);
  assert.equal((await customer("/orders")).orders.length, 1);
});

test("coupon eligibility, caps, expiry, first order and minimum spend are enforced", async (t) => {
  const { db, customer, add, order } = await fixture(t);
  await add();
  await customer("/cart/quote", {
    method: "POST",
    body: { coupon: "WELCOME20" },
    expect: 400,
  });
  await add({ quantity: 4 });
  const q = await customer("/cart/quote", {
    method: "POST",
    body: { coupon: "WELCOME20" },
  });
  assert.equal(q.discount_cents, 15000);
  await order({ coupon: "WELCOME20" });
  await add({ quantity: 2 });
  await customer("/cart/quote", {
    method: "POST",
    body: { coupon: "WELCOME20" },
    expect: 400,
  });
  db.prepare("UPDATE coupons SET expires_at=? WHERE code=?").run(
    "2020-01-01T00:00:00Z",
    "FEAST50",
  );
  await customer("/cart/quote", {
    method: "POST",
    body: { coupon: "FEAST50" },
    expect: 400,
  });
});

test("cart validates options, quantity and one restaurant; checkout blocks unavailable items", async (t) => {
  const { customer, admin, add } = await fixture(t);
  await add();
  await customer("/cart", {
    method: "POST",
    body: {
      menu_id: "burger-classic",
      size: "wrong",
      sauce: "none",
      quantity: 1,
    },
    expect: 400,
  });
  await customer("/cart", {
    method: "POST",
    body: {
      menu_id: "burger-classic",
      size: "regular",
      sauce: "none",
      quantity: -1,
    },
    expect: 400,
  });
  await customer("/cart", {
    method: "POST",
    body: {
      menu_id: "pizza-margherita",
      size: "regular",
      sauce: "none",
      quantity: 1,
    },
    expect: 409,
  });
  await customer("/cart", { method: "POST", body: {}, expect: 400 });
  await admin("/admin/menu/burger-classic", {
    method: "PATCH",
    body: { available: false },
  });
  await customer("/cart/quote", { method: "POST", body: {}, expect: 409 });
});

test("cancellation rules, sequencing, demo payment and review uniqueness are enforced", async (t) => {
  const { customer, admin, add, order } = await fixture(t);
  await add();
  const { order: o } = await order({ payment_method: "demo" });
  await admin(`/orders/${o.id}/status`, {
    method: "PATCH",
    body: { status: "delivered" },
    expect: 409,
  });
  await customer(`/orders/${o.id}/review`, {
    method: "POST",
    body: { rating: 5 },
    expect: 409,
  });
  const cancelled = await customer(`/orders/${o.id}/cancel`, {
    method: "POST",
    body: {},
  });
  assert.equal(cancelled.order.payment_status, "demo_refunded");
  await customer(`/orders/${o.id}/demo-advance`, {
    method: "POST",
    body: {},
    expect: 409,
  });
  await add();
  const { order: p } = await order();
  for (let i = 0; i < 2; i++)
    await customer(`/orders/${p.id}/demo-advance`, {
      method: "POST",
      body: {},
    });
  await customer(`/orders/${p.id}/cancel`, {
    method: "POST",
    body: {},
    expect: 409,
  });
  for (let i = 0; i < 3; i++)
    await customer(`/orders/${p.id}/demo-advance`, {
      method: "POST",
      body: {},
    });
  await customer(`/orders/${p.id}/review`, {
    method: "POST",
    body: { rating: 5 },
  });
  await customer(`/orders/${p.id}/review`, {
    method: "POST",
    body: { rating: 5 },
    expect: 409,
  });
});

test("standard mode disables payment simulation and demo status advancement", async (t) => {
  const { customer, add } = await fixture(t, { demo: false });
  await add();
  assert.deepEqual((await customer("/config")).payments, ["cod"]);
  await customer("/orders", {
    method: "POST",
    body: {
      address_id: "demo-home",
      payment_method: "demo",
      idempotency_key: randomUUID(),
    },
    expect: 400,
  });
  const { order: o } = await customer("/orders", {
    method: "POST",
    body: {
      address_id: "demo-home",
      payment_method: "cod",
      idempotency_key: randomUUID(),
    },
  });
  await customer(`/orders/${o.id}/demo-advance`, {
    method: "POST",
    body: {},
    expect: 404,
  });
});

test("CSRF headers, cross-origin mutations, session revocation and anonymous access", async (t) => {
  const { base, customer, client } = await fixture(t);
  const anon = client();
  await anon("/cart", { expect: 401 });
  await customer("/profile", {
    method: "PATCH",
    body: { name: "Invalid" },
    headers: { Origin: "https://evil.example" },
    expect: 403,
  });
  const response = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 403);
  await customer("/auth/logout", { method: "POST", body: {} });
  await customer("/cart", { expect: 401 });
  await customer("/auth/login", {
    method: "POST",
    body: { email: "customer@foodlane.local", password: "wrong" },
    expect: 401,
  });
});

test("favorites, address edits, snapshots and reordering use persistent records", async (t) => {
  const { customer, add, order } = await fixture(t);
  await customer("/favorites/burger-classic", { method: "POST", body: {} });
  assert.equal((await customer("/favorites")).items.length, 1);
  await add();
  const { order: o } = await order();
  await customer("/addresses/demo-home", { method: "DELETE", body: {} });
  assert.equal(
    (await customer(`/orders/${o.id}`)).order.address.city,
    "Dehradun",
  );
  const result = await customer(`/orders/${o.id}/reorder`, {
    method: "POST",
    body: {},
  });
  assert.equal(result.items.length, 1);
  await customer(`/orders/${o.id}/reorder`, {
    method: "POST",
    body: {},
    expect: 409,
  });
  await customer("/favorites/burger-classic", { method: "DELETE", body: {} });
  assert.equal((await customer("/favorites")).items.length, 0);
});

test("new account cannot register as admin; password changes revoke other sessions", async (t) => {
  const { client, db } = await fixture(t);
  const a = client(),
    b = client();
  await a("/auth/register", {
    method: "POST",
    body: {
      name: "Test User",
      email: "new@example.test",
      password: "Password123!",
      role: "admin",
    },
  });
  assert.equal((await a("/auth/me")).user.role, "customer");
  await b("/auth/login", {
    method: "POST",
    body: { email: "new@example.test", password: "Password123!" },
  });
  await a("/profile/password", {
    method: "POST",
    body: {
      current_password: "Password123!",
      new_password: "ChangedPassword123!",
    },
  });
  await b("/cart", { expect: 401 });
  assert.ok((await a("/auth/me")).user);
  const row = db
    .prepare("SELECT password FROM users WHERE email=?")
    .get("new@example.test");
  assert.ok(!row.password.includes("Password123!"));
});

test("dispatch requires a driver and only assigned drivers can pick up and deliver", async (t) => {
  const { admin, driver, add, order } = await fixture(t);
  await add();
  const { order: o } = await order();
  for (const status of ["accepted", "preparing", "ready"])
    await admin(`/orders/${o.id}/status`, {
      method: "PATCH",
      body: { status },
    });
  await admin(`/orders/${o.id}/status`, {
    method: "PATCH",
    body: { status: "out_for_delivery" },
    expect: 400,
  });
  await admin(`/admin/orders/${o.id}/driver`, {
    method: "PATCH",
    body: { driver_id: "driver-demo" },
  });
  await driver(`/orders/${o.id}/cancel`, {
    method: "POST",
    body: {},
    expect: 403,
  });
  await driver(`/orders/${o.id}/status`, {
    method: "PATCH",
    body: { status: "out_for_delivery" },
  });
});

test("admin can create menu and coupons; invalid prices cannot change live menu", async (t) => {
  const { admin, customer } = await fixture(t);
  const { item } = await admin("/admin/menu", {
    method: "POST",
    body: {
      restaurant_id: "ember",
      name: "Test Bowl",
      description: "A fresh bowl.",
      category: "Bowls",
      price_cents: 25000,
      image: "salad",
      vegetarian: true,
    },
  });
  assert.equal(item.price_cents, 25000);
  await admin(`/admin/menu/${item.id}`, {
    method: "PATCH",
    body: { price_cents: -1 },
    expect: 400,
  });
  await admin("/admin/coupons", {
    method: "POST",
    body: {
      code: "TEST10",
      description: "Test coupon",
      type: "percent",
      value: 10,
      min_cents: 10000,
      cap_cents: 5000,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  assert.ok(
    (await customer("/coupons")).coupons.find((x) => x.code === "TEST10"),
  );
  await admin("/admin/coupons/TEST10", {
    method: "PATCH",
    body: { active: false },
  });
  assert.ok(
    !(await customer("/coupons")).coupons.find((x) => x.code === "TEST10"),
  );
});

test("static assets and SPA deep links are served, private files are not exposed", async (t) => {
  const { base } = await fixture(t);
  const index = await fetch(base + "/");
  assert.equal(index.status, 200);
  assert.match(await index.text(), /FoodLane/);
  assert.equal((await fetch(base + "/images/burger.jpg")).status, 200);
  assert.equal((await fetch(base + "/orders")).status, 200);
  assert.equal((await fetch(base + "/.env")).status, 403);
  assert.equal((await fetch(base + "/server/db.mjs")).status, 404);
});

test("SQLite records survive close and reopen without reseeding or duplication", () => {
  const folder = mkdtempSync(join(tmpdir(), "foodlane-persist-"));
  try {
    const file = join(folder, "test.sqlite");
    let db = openDatabase(file);
    db.prepare("UPDATE users SET name=? WHERE id=?").run(
      "Persisted Name",
      "customer-demo",
    );
    db.close();
    db = openDatabase(file);
    assert.equal(
      db.prepare("SELECT name FROM users WHERE id=?").get("customer-demo").name,
      "Persisted Name",
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM menu").get().n, 14);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 3);
    db.close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
