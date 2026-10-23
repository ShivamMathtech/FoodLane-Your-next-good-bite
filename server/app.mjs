import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { id, now, hashPassword, checkPassword } from "./db.mjs";

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new AppError(status, message);
};
const textField = (v, label, max = 200, min = 1) => {
  if (typeof v !== "string" || v.trim().length < min || v.trim().length > max)
    fail(400, `${label} must contain ${min}–${max} characters.`);
  return v.trim();
};
const integer = (v, label, min, max) => {
  if (!Number.isInteger(v) || v < min || v > max)
    fail(400, `${label} must be a whole number between ${min} and ${max}.`);
  return v;
};
const publicUser = (u) =>
  u
    ? { id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone }
    : null;
const hash = (s) => createHash("sha256").update(s).digest("hex");
const STATUS_FLOW = [
  "placed",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
];
const parseMenu = (row) => ({
  ...row,
  options: JSON.parse(row.options),
  vegetarian: !!row.vegetarian,
  available: !!row.available,
});

export function createApp({
  db,
  publicDir,
  demo = true,
  secureCookies = false,
  appOrigin = "",
  logger = console,
}) {
  const routes = [];
  const rateLimits = new Map();
  const route = (method, path, role, fn) =>
    routes.push({ method, pattern: new RegExp(`^${path}$`), role, fn });
  const getMenu = (mid) => {
    textField(mid, "Menu item", 80);
    const row = db
      .prepare(
        "SELECT m.*,r.name AS restaurant_name,r.active AS restaurant_active FROM menu m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.id=?",
      )
      .get(mid);
    if (!row) fail(404, "Menu item not found.");
    return parseMenu(row);
  };
  const calculateItem = (mid, quantity, size, sauce, note = "") => {
    const item = getMenu(mid);
    if (!item.available || !item.restaurant_active)
      fail(409, `${item.name} is currently unavailable.`);
    integer(quantity, "Quantity", 1, 20);
    const s = item.options.sizes.find((x) => x.id === size),
      a = item.options.sauces.find((x) => x.id === sauce);
    if (!s || !a) fail(400, "Please choose valid size and sauce options.");
    return {
      ...item,
      quantity,
      size,
      sauce,
      size_label: s.label,
      sauce_label: a.label,
      note: textField(note, "Note", 250, 0),
      unit_cents: item.price_cents + s.add_cents + a.add_cents,
    };
  };
  function cart(uid) {
    const rows = db
      .prepare(
        "SELECT c.*,m.name,m.image,m.price_cents,m.available,m.options,m.restaurant_id,r.name AS restaurant_name,r.active AS restaurant_active FROM cart_items c JOIN menu m ON m.id=c.menu_id JOIN restaurants r ON r.id=m.restaurant_id WHERE c.user_id=? ORDER BY c.rowid",
      )
      .all(uid);
    return rows.map((row) => {
      const opts = JSON.parse(row.options),
        size = opts.sizes.find((x) => x.id === row.size),
        sauce = opts.sauces.find((x) => x.id === row.sauce);
      const { options, ...rest } = row;
      return {
        ...rest,
        unit_cents:
          row.price_cents + (size?.add_cents || 0) + (sauce?.add_cents || 0),
        size_label: size?.label || row.size,
        sauce_label: sauce?.label || row.sauce,
        available:
          !!row.available && !!row.restaurant_active && !!size && !!sauce,
      };
    });
  }
  function quote(uid, code = "") {
    const items = cart(uid);
    if (!items.length) fail(400, "Your cart is empty.");
    if (items.some((x) => !x.available))
      fail(
        409,
        "An item is unavailable. Remove it from your cart to continue.",
      );
    if (new Set(items.map((x) => x.restaurant_id)).size !== 1)
      fail(409, "A cart can only contain items from one restaurant.");
    const restaurant = db
      .prepare("SELECT * FROM restaurants WHERE id=?")
      .get(items[0].restaurant_id);
    const subtotal = items.reduce(
      (sum, x) => sum + x.unit_cents * x.quantity,
      0,
    );
    const delivery = subtotal >= 59900 ? 0 : restaurant.delivery_cents;
    const packaging = 1500;
    let discount = 0,
      coupon = null;
    if (code) {
      const normalized = textField(code, "Coupon code", 32).toUpperCase();
      coupon = db
        .prepare("SELECT * FROM coupons WHERE code=? AND active=1")
        .get(normalized);
      if (!coupon || Date.parse(coupon.expires_at) < Date.now())
        fail(400, "This coupon is invalid or expired.");
      if (subtotal < coupon.min_cents)
        fail(
          400,
          `This coupon needs a minimum order of ₹${(coupon.min_cents / 100).toFixed(0)}.`,
        );
      if (
        coupon.first_only &&
        db
          .prepare(
            "SELECT id FROM orders WHERE user_id=? AND status!='cancelled' LIMIT 1",
          )
          .get(uid)
      )
        fail(400, "This coupon is only available for your first order.");
      discount = Math.min(
        subtotal,
        coupon.cap_cents,
        coupon.type === "percent"
          ? Math.floor((subtotal * coupon.value) / 100)
          : coupon.value,
      );
    }
    return {
      items,
      restaurant,
      subtotal_cents: subtotal,
      discount_cents: discount,
      delivery_cents: delivery,
      packaging_cents: packaging,
      total_cents: subtotal - discount + delivery + packaging,
      coupon_code: coupon?.code || null,
    };
  }
  function getOrder(oid, user) {
    const row = db
      .prepare(
        "SELECT o.*,r.name AS restaurant_name,r.image AS restaurant_image,r.eta,r.address AS restaurant_address,u.name AS customer_name,d.name AS driver_name,d.phone AS driver_phone FROM orders o JOIN restaurants r ON r.id=o.restaurant_id JOIN users u ON u.id=o.user_id LEFT JOIN users d ON d.id=o.driver_id WHERE o.id=?",
      )
      .get(oid);
    if (!row) fail(404, "Order not found.");
    if (
      user.role !== "admin" &&
      row.user_id !== user.id &&
      !(user.role === "driver" && row.driver_id === user.id)
    )
      fail(403, "You cannot access this order.");
    return {
      ...row,
      address: JSON.parse(row.address),
      items: db.prepare("SELECT * FROM order_items WHERE order_id=?").all(oid),
      events: db
        .prepare(
          "SELECT status,created_at FROM order_events WHERE order_id=? ORDER BY id",
        )
        .all(oid),
      review:
        db.prepare("SELECT * FROM reviews WHERE order_id=?").get(oid) || null,
    };
  }
  function transition(oid, status, user, { demoAction = false } = {}) {
    const order = getOrder(oid, user);
    if (["delivered", "cancelled"].includes(order.status))
      fail(409, "This order is already completed.");
    if (status === "cancelled") {
      if (user.role === "driver") fail(403, "Drivers cannot cancel orders.");
      if (
        user.role !== "admin" &&
        !["placed", "accepted"].includes(order.status)
      )
        fail(
          409,
          "This order is already being prepared and can no longer be cancelled.",
        );
    } else {
      if (user.role === "customer" && !demoAction)
        fail(
          403,
          "Only the kitchen or assigned driver can update delivery status.",
        );
      if (STATUS_FLOW[STATUS_FLOW.indexOf(order.status) + 1] !== status)
        fail(409, "Order statuses must be completed in sequence.");
      if (
        user.role === "driver" &&
        !["out_for_delivery", "delivered"].includes(status)
      )
        fail(403, "Drivers can only pick up and deliver assigned orders.");
      if (status === "out_for_delivery" && !order.driver_id && !demoAction)
        fail(400, "Assign a driver before dispatching this order.");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      if (demoAction && !order.driver_id)
        db.prepare("UPDATE orders SET driver_id=? WHERE id=?").run(
          "driver-demo",
          oid,
        );
      const payment =
        status === "cancelled" && order.payment_method === "demo"
          ? "demo_refunded"
          : status === "delivered" && order.payment_method === "cod"
            ? "collected"
            : order.payment_status;
      db.prepare(
        "UPDATE orders SET status=?,payment_status=?,updated_at=? WHERE id=?",
      ).run(status, payment, now(), oid);
      db.prepare(
        "INSERT INTO order_events(order_id,status,created_at,actor_id) VALUES(?,?,?,?)",
      ).run(oid, status, now(), user.id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return getOrder(oid, user);
  }
  function createSession(ctx, user) {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(token),
      user.id,
      Date.now() + 7 * 86400000,
    );
    ctx.res.setHeader(
      "Set-Cookie",
      `foodlane_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secureCookies ? "; Secure" : ""}`,
    );
    return { user: publicUser(user) };
  }
  function throttle(key, max = 20) {
    const t = Date.now(),
      old = rateLimits.get(key);
    if (!old || old.expires < t)
      rateLimits.set(key, { count: 1, expires: t + 15 * 60000 });
    else if (++old.count > max)
      fail(429, "Too many attempts. Please wait 15 minutes.");
    if (rateLimits.size > 10000)
      for (const [k, v] of rateLimits) if (v.expires < t) rateLimits.delete(k);
  }
  const emailField = (value) => {
    const email = textField(value, "Email", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      fail(400, "Enter a valid email address.");
    return email;
  };
  const passwordField = (value) => textField(value, "Password", 128, 10);
  const addressFields = (b) => [
    textField(b.label, "Label", 30),
    textField(b.recipient, "Recipient", 80),
    textField(b.phone, "Phone", 20, 7),
    textField(b.line1, "Street address", 180, 5),
    textField(b.city, "City", 60, 2),
    textField(b.postcode, "Postcode", 12, 3),
    textField(b.instructions || "", "Delivery instructions", 250, 0),
  ];

  route("GET", "/api/health", null, () => ({
    ok: true,
    service: "FoodLane",
    version: "1.0.0",
  }));
  route("GET", "/api/config", null, () => ({
    demo,
    currency: "INR",
    payments: demo ? ["cod", "demo"] : ["cod"],
    free_delivery_min_cents: 59900,
  }));
  route("GET", "/api/auth/me", null, (ctx) => ({ user: publicUser(ctx.user) }));
  route("POST", "/api/auth/register", null, (ctx) => {
    throttle(`register:${ctx.ip}`, 10);
    const b = ctx.body,
      email = emailField(b.email),
      password = passwordField(b.password),
      name = textField(b.name, "Name", 80, 2);
    if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
      fail(409, "This email is already registered. Sign in instead.");
    const uid = id();
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?)").run(
      uid,
      name,
      email,
      hashPassword(password),
      "customer",
      "",
      now(),
    );
    return createSession(
      ctx,
      db.prepare("SELECT * FROM users WHERE id=?").get(uid),
    );
  });
  route("POST", "/api/auth/login", null, (ctx) => {
    throttle(`login:${ctx.ip}`);
    const email = emailField(ctx.body.email),
      password = textField(ctx.body.password, "Password", 128);
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!user || !checkPassword(password, user.password))
      fail(401, "Email or password is incorrect.");
    if (ctx.token)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
        hash(ctx.token),
      );
    return createSession(ctx, user);
  });
  route("POST", "/api/auth/logout", "any", (ctx) => {
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(ctx.token));
    ctx.res.setHeader(
      "Set-Cookie",
      `foodlane_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? "; Secure" : ""}`,
    );
    return { ok: true };
  });
  route("PATCH", "/api/profile", "any", (ctx) => {
    db.prepare("UPDATE users SET name=?,phone=? WHERE id=?").run(
      textField(ctx.body.name, "Name", 80, 2),
      textField(ctx.body.phone || "", "Phone", 20, 0),
      ctx.user.id,
    );
    return {
      user: publicUser(
        db.prepare("SELECT * FROM users WHERE id=?").get(ctx.user.id),
      ),
    };
  });
  route("POST", "/api/profile/password", "any", (ctx) => {
    const current = textField(
        ctx.body.current_password,
        "Current password",
        128,
      ),
      next = passwordField(ctx.body.new_password);
    throttle(`password:${ctx.ip}`);
    if (!checkPassword(current, ctx.user.password))
      fail(400, "Current password is incorrect.");
    db.prepare("UPDATE users SET password=? WHERE id=?").run(
      hashPassword(next),
      ctx.user.id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash!=?").run(
      ctx.user.id,
      hash(ctx.token),
    );
    return { ok: true };
  });
  route("GET", "/api/restaurants", null, () => ({
    restaurants: db
      .prepare(
        "SELECT r.*,(SELECT AVG(rating) FROM reviews WHERE restaurant_id=r.id) AS rating,(SELECT COUNT(*) FROM reviews WHERE restaurant_id=r.id) AS review_count FROM restaurants r WHERE active=1",
      )
      .all(),
  }));
  route("GET", "/api/restaurants/([^/]+)", null, (ctx) => {
    const r = db
      .prepare("SELECT * FROM restaurants WHERE id=? AND active=1")
      .get(ctx.params[0]);
    if (!r) fail(404, "Restaurant not found.");
    return {
      restaurant: r,
      menu: db
        .prepare("SELECT * FROM menu WHERE restaurant_id=?")
        .all(r.id)
        .map(parseMenu),
      reviews: db
        .prepare(
          "SELECT v.rating,v.body,v.created_at,u.name FROM reviews v JOIN users u ON u.id=v.user_id WHERE v.restaurant_id=? ORDER BY v.created_at DESC LIMIT 100",
        )
        .all(r.id),
    };
  });
  route("GET", "/api/menu", null, (ctx) => {
    const q = (ctx.url.searchParams.get("q") || "").slice(0, 100).toLowerCase();
    let items = db
      .prepare(
        "SELECT m.*,r.name AS restaurant_name FROM menu m JOIN restaurants r ON r.id=m.restaurant_id WHERE r.active=1",
      )
      .all()
      .map(parseMenu);
    if (q)
      items = items.filter((x) =>
        `${x.name} ${x.description} ${x.category} ${x.restaurant_name}`
          .toLowerCase()
          .includes(q),
      );
    return { items };
  });
  route("GET", "/api/favorites", "customer", (ctx) => ({
    items: db
      .prepare(
        "SELECT m.*,r.name AS restaurant_name FROM favorites f JOIN menu m ON m.id=f.menu_id JOIN restaurants r ON r.id=m.restaurant_id WHERE f.user_id=?",
      )
      .all(ctx.user.id)
      .map(parseMenu),
  }));
  route("POST", "/api/favorites/([^/]+)", "customer", (ctx) => {
    getMenu(ctx.params[0]);
    db.prepare("INSERT OR IGNORE INTO favorites VALUES(?,?)").run(
      ctx.user.id,
      ctx.params[0],
    );
    return { ok: true };
  });
  route("DELETE", "/api/favorites/([^/]+)", "customer", (ctx) => {
    db.prepare("DELETE FROM favorites WHERE user_id=? AND menu_id=?").run(
      ctx.user.id,
      ctx.params[0],
    );
    return { ok: true };
  });
  route("GET", "/api/addresses", "customer", (ctx) => ({
    addresses: db
      .prepare("SELECT * FROM addresses WHERE user_id=? ORDER BY rowid")
      .all(ctx.user.id),
  }));
  route("POST", "/api/addresses", "customer", (ctx) => {
    if (
      db
        .prepare("SELECT COUNT(*) AS n FROM addresses WHERE user_id=?")
        .get(ctx.user.id).n >= 20
    )
      fail(400, "You can save up to 20 addresses.");
    const aid = id();
    db.prepare("INSERT INTO addresses VALUES(?,?,?,?,?,?,?,?,?)").run(
      aid,
      ctx.user.id,
      ...addressFields(ctx.body),
    );
    return {
      address: db.prepare("SELECT * FROM addresses WHERE id=?").get(aid),
    };
  });
  route("PATCH", "/api/addresses/([^/]+)", "customer", (ctx) => {
    const result = db
      .prepare(
        "UPDATE addresses SET label=?,recipient=?,phone=?,line1=?,city=?,postcode=?,instructions=? WHERE id=? AND user_id=?",
      )
      .run(...addressFields(ctx.body), ctx.params[0], ctx.user.id);
    if (!result.changes) fail(404, "Address not found.");
    return { ok: true };
  });
  route("DELETE", "/api/addresses/([^/]+)", "customer", (ctx) => {
    const r = db
      .prepare("DELETE FROM addresses WHERE id=? AND user_id=?")
      .run(ctx.params[0], ctx.user.id);
    if (!r.changes) fail(404, "Address not found.");
    return { ok: true };
  });
  route("GET", "/api/cart", "customer", (ctx) => ({
    items: cart(ctx.user.id),
  }));
  route("POST", "/api/cart", "customer", (ctx) => {
    const b = ctx.body,
      item = calculateItem(
        b.menu_id,
        b.quantity,
        b.size,
        b.sauce,
        b.note || "",
      ),
      current = cart(ctx.user.id);
    if (current.some((x) => x.restaurant_id !== item.restaurant_id))
      fail(
        409,
        "Your cart has food from another restaurant. Clear it before adding this item.",
      );
    const same = current.find(
      (x) =>
        x.menu_id === item.id &&
        x.size === b.size &&
        x.sauce === b.sauce &&
        x.note === item.note,
    );
    if (same) {
      integer(same.quantity + b.quantity, "Combined quantity", 1, 20);
      db.prepare("UPDATE cart_items SET quantity=? WHERE id=?").run(
        same.quantity + b.quantity,
        same.id,
      );
    } else {
      if (current.length >= 40)
        fail(400, "Your cart can contain at most 40 different items.");
      db.prepare("INSERT INTO cart_items VALUES(?,?,?,?,?,?,?)").run(
        id(),
        ctx.user.id,
        item.id,
        b.quantity,
        b.size,
        b.sauce,
        item.note,
      );
    }
    return { items: cart(ctx.user.id) };
  });
  route("PATCH", "/api/cart/([^/]+)", "customer", (ctx) => {
    integer(ctx.body.quantity, "Quantity", 1, 20);
    const r = db
      .prepare("UPDATE cart_items SET quantity=? WHERE id=? AND user_id=?")
      .run(ctx.body.quantity, ctx.params[0], ctx.user.id);
    if (!r.changes) fail(404, "Cart item not found.");
    return { items: cart(ctx.user.id) };
  });
  route("DELETE", "/api/cart/([^/]+)", "customer", (ctx) => {
    db.prepare("DELETE FROM cart_items WHERE id=? AND user_id=?").run(
      ctx.params[0],
      ctx.user.id,
    );
    return { items: cart(ctx.user.id) };
  });
  route("DELETE", "/api/cart", "customer", (ctx) => {
    db.prepare("DELETE FROM cart_items WHERE user_id=?").run(ctx.user.id);
    return { items: [] };
  });
  route("POST", "/api/cart/quote", "customer", (ctx) =>
    quote(ctx.user.id, ctx.body.coupon || ""),
  );
  route("GET", "/api/coupons", "customer", () => ({
    coupons: db
      .prepare("SELECT * FROM coupons WHERE active=1 AND expires_at>?")
      .all(now()),
  }));
  route("POST", "/api/orders", "customer", (ctx) => {
    const b = ctx.body,
      key = textField(b.idempotency_key, "Request key", 80, 8);
    const existing = db
      .prepare("SELECT id FROM orders WHERE user_id=? AND idempotency_key=?")
      .get(ctx.user.id, key);
    if (existing) return { order: getOrder(existing.id, ctx.user) };
    const address = db
      .prepare("SELECT * FROM addresses WHERE id=? AND user_id=?")
      .get(textField(b.address_id, "Delivery address", 80), ctx.user.id);
    if (!address) fail(400, "Choose a valid delivery address.");
    if (!["cod", ...(demo ? ["demo"] : [])].includes(b.payment_method))
      fail(400, "Choose an available payment method.");
    const instructions = textField(
      b.instructions || "",
      "Instructions",
      400,
      0,
    );
    let scheduled = null;
    if (b.scheduled_for) {
      const t = Date.parse(b.scheduled_for);
      if (
        !Number.isFinite(t) ||
        t < Date.now() + 30 * 60000 ||
        t > Date.now() + 7 * 86400000
      )
        fail(
          400,
          "Schedule delivery at least 30 minutes ahead and within 7 days.",
        );
      scheduled = new Date(t).toISOString();
    }
    db.exec("BEGIN IMMEDIATE");
    let oid;
    try {
      const q = quote(ctx.user.id, b.coupon || "");
      oid = id();
      const created = now();
      const number = `FL-${randomBytes(4).toString("hex").toUpperCase()}`;
      db.prepare(
        "INSERT INTO orders(id,number,user_id,restaurant_id,status,payment_method,payment_status,subtotal_cents,discount_cents,delivery_cents,packaging_cents,total_cents,coupon_code,address,instructions,scheduled_for,created_at,updated_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        oid,
        number,
        ctx.user.id,
        q.restaurant.id,
        "placed",
        b.payment_method,
        b.payment_method === "demo" ? "demo_paid" : "unpaid",
        q.subtotal_cents,
        q.discount_cents,
        q.delivery_cents,
        q.packaging_cents,
        q.total_cents,
        q.coupon_code,
        JSON.stringify(address),
        instructions,
        scheduled,
        created,
        created,
        key,
      );
      const insert = db.prepare(
        "INSERT INTO order_items VALUES(?,?,?,?,?,?,?,?,?,?)",
      );
      for (const x of q.items)
        insert.run(
          id(),
          oid,
          x.menu_id,
          x.name,
          x.image,
          x.quantity,
          x.unit_cents,
          x.size,
          x.sauce,
          x.note,
        );
      db.prepare(
        "INSERT INTO order_events(order_id,status,created_at,actor_id) VALUES(?,?,?,?)",
      ).run(oid, "placed", created, ctx.user.id);
      db.prepare("DELETE FROM cart_items WHERE user_id=?").run(ctx.user.id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { order: getOrder(oid, ctx.user) };
  });
  route("GET", "/api/orders", "any", (ctx) => {
    let rows;
    if (ctx.user.role === "admin")
      rows = db
        .prepare("SELECT id FROM orders ORDER BY created_at DESC LIMIT 300")
        .all();
    else if (ctx.user.role === "driver")
      rows = db
        .prepare(
          "SELECT id FROM orders WHERE driver_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .all(ctx.user.id);
    else
      rows = db
        .prepare(
          "SELECT id FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .all(ctx.user.id);
    return { orders: rows.map((x) => getOrder(x.id, ctx.user)) };
  });
  route("GET", "/api/orders/([^/]+)", "any", (ctx) => ({
    order: getOrder(ctx.params[0], ctx.user),
  }));
  route("POST", "/api/orders/([^/]+)/cancel", "any", (ctx) => ({
    order: transition(ctx.params[0], "cancelled", ctx.user),
  }));
  route("POST", "/api/orders/([^/]+)/demo-advance", "customer", (ctx) => {
    if (!demo) fail(404, "Demo actions are disabled.");
    const order = getOrder(ctx.params[0], ctx.user),
      next = STATUS_FLOW[STATUS_FLOW.indexOf(order.status) + 1];
    if (!next || order.status === "cancelled")
      fail(409, "This order is already completed.");
    return {
      order: transition(order.id, next, ctx.user, { demoAction: true }),
    };
  });
  route("POST", "/api/orders/([^/]+)/reorder", "customer", (ctx) => {
    const order = getOrder(ctx.params[0], ctx.user);
    const items = order.items.map((x) =>
      calculateItem(x.menu_id, x.quantity, x.size, x.sauce, x.note),
    );
    if (cart(ctx.user.id).length && !ctx.body.replace)
      fail(409, "Your cart is not empty. Confirm replacement to reorder.");
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM cart_items WHERE user_id=?").run(ctx.user.id);
      for (const x of items)
        db.prepare("INSERT INTO cart_items VALUES(?,?,?,?,?,?,?)").run(
          id(),
          ctx.user.id,
          x.id,
          x.quantity,
          x.size,
          x.sauce,
          x.note,
        );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { items: cart(ctx.user.id) };
  });
  route("GET", "/api/orders/([^/]+)/messages", "any", (ctx) => {
    getOrder(ctx.params[0], ctx.user);
    return {
      messages: db
        .prepare(
          "SELECT m.*,u.name,u.role FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.order_id=? ORDER BY m.id",
        )
        .all(ctx.params[0]),
    };
  });
  route("POST", "/api/orders/([^/]+)/messages", "any", (ctx) => {
    getOrder(ctx.params[0], ctx.user);
    throttle(`message:${ctx.user.id}`, 120);
    const body = textField(ctx.body.body, "Message", 1000);
    db.prepare(
      "INSERT INTO messages(order_id,sender_id,body,created_at) VALUES(?,?,?,?)",
    ).run(ctx.params[0], ctx.user.id, body, now());
    return { ok: true };
  });
  route("POST", "/api/orders/([^/]+)/review", "customer", (ctx) => {
    const order = getOrder(ctx.params[0], ctx.user),
      b = ctx.body;
    if (order.status !== "delivered")
      fail(409, "Reviews are available after delivery.");
    if (order.review) fail(409, "You have already reviewed this order.");
    const rating = integer(b.rating, "Restaurant rating", 1, 5),
      driverRating = b.driver_rating
        ? integer(b.driver_rating, "Driver rating", 1, 5)
        : null;
    if (driverRating && !order.driver_id)
      fail(400, "No driver is assigned to this order.");
    db.prepare("INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?)").run(
      id(),
      order.id,
      ctx.user.id,
      order.restaurant_id,
      rating,
      driverRating,
      textField(b.body || "", "Review", 1000, 0),
      now(),
    );
    return { ok: true };
  });
  route("GET", "/api/admin/stats", "admin", () => ({
    stats: db
      .prepare(
        "SELECT COUNT(*) AS total_orders,COALESCE(SUM(CASE WHEN status='delivered' THEN total_cents ELSE 0 END),0) AS revenue_cents,COALESCE(SUM(CASE WHEN status NOT IN ('delivered','cancelled') THEN 1 ELSE 0 END),0) AS active_orders,(SELECT COUNT(*) FROM users WHERE role='customer') AS customers FROM orders",
      )
      .get(),
  }));
  route("GET", "/api/admin/drivers", "admin", () => ({
    drivers: db
      .prepare("SELECT id,name,email FROM users WHERE role='driver'")
      .all(),
  }));
  route("PATCH", "/api/admin/orders/([^/]+)/driver", "admin", (ctx) => {
    const order = getOrder(ctx.params[0], ctx.user);
    if (["delivered", "cancelled"].includes(order.status))
      fail(409, "Completed orders cannot be reassigned.");
    if (
      !db
        .prepare("SELECT id FROM users WHERE id=? AND role='driver'")
        .get(textField(ctx.body.driver_id, "Driver", 80))
    )
      fail(400, "Select a valid driver.");
    db.prepare("UPDATE orders SET driver_id=?,updated_at=? WHERE id=?").run(
      ctx.body.driver_id,
      now(),
      order.id,
    );
    return { order: getOrder(order.id, ctx.user) };
  });
  route("PATCH", "/api/orders/([^/]+)/status", "staff", (ctx) => ({
    order: transition(ctx.params[0], ctx.body.status, ctx.user),
  }));
  route("PATCH", "/api/admin/menu/([^/]+)", "admin", (ctx) => {
    const old = getMenu(ctx.params[0]),
      b = ctx.body;
    const price =
      b.price_cents === undefined
        ? old.price_cents
        : integer(b.price_cents, "Price in paise", 1, 1000000);
    const available = b.available === undefined ? old.available : b.available;
    if (typeof available !== "boolean")
      fail(400, "Availability must be true or false.");
    db.prepare(
      "UPDATE menu SET name=?,description=?,price_cents=?,available=? WHERE id=?",
    ).run(
      textField(b.name ?? old.name, "Item name", 100),
      textField(b.description ?? old.description, "Description", 600),
      price,
      available ? 1 : 0,
      old.id,
    );
    return { item: getMenu(old.id) };
  });
  route("POST", "/api/admin/menu", "admin", (ctx) => {
    const b = ctx.body;
    if (
      !db
        .prepare("SELECT id FROM restaurants WHERE id=?")
        .get(textField(b.restaurant_id, "Restaurant", 80))
    )
      fail(400, "Select a valid restaurant.");
    const images = [
      "burger",
      "pizza",
      "salad",
      "wings",
      "pasta",
      "fries",
      "dessert",
      "coffee",
    ];
    if (!images.includes(b.image)) fail(400, "Select a bundled food image.");
    const mid = id(),
      opts = JSON.stringify({
        sizes: [{ id: "regular", label: "Regular", add_cents: 0 }],
        sauces: [{ id: "none", label: "None", add_cents: 0 }],
      });
    db.prepare(
      "INSERT INTO menu(id,restaurant_id,name,description,category,price_cents,image,vegetarian,options) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      mid,
      b.restaurant_id,
      textField(b.name, "Name", 100),
      textField(b.description, "Description", 600),
      textField(b.category, "Category", 40),
      integer(b.price_cents, "Price in paise", 1, 1000000),
      `/images/${b.image}.jpg`,
      b.vegetarian ? 1 : 0,
      opts,
    );
    return { item: getMenu(mid) };
  });
  route("GET", "/api/admin/coupons", "admin", () => ({
    coupons: db.prepare("SELECT * FROM coupons ORDER BY rowid DESC").all(),
  }));
  route("POST", "/api/admin/coupons", "admin", (ctx) => {
    const b = ctx.body,
      code = textField(b.code, "Code", 32, 3).toUpperCase();
    if (!/^[A-Z0-9]+$/.test(code))
      fail(400, "Codes may only contain letters and numbers.");
    if (db.prepare("SELECT code FROM coupons WHERE code=?").get(code))
      fail(409, "This coupon already exists.");
    if (!["percent", "fixed"].includes(b.type))
      fail(400, "Invalid discount type.");
    const value = integer(
        b.value,
        "Value",
        1,
        b.type === "percent" ? 100 : 100000,
      ),
      min = integer(b.min_cents, "Minimum order", 0, 1000000),
      cap = integer(b.cap_cents, "Maximum discount", 1, 100000);
    const expires = Date.parse(b.expires_at);
    if (!Number.isFinite(expires) || expires < Date.now())
      fail(400, "Choose a future expiry date.");
    db.prepare("INSERT INTO coupons VALUES(?,?,?,?,?,?,?,?,1)").run(
      code,
      textField(b.description, "Description", 200),
      b.type,
      value,
      min,
      cap,
      b.first_only ? 1 : 0,
      new Date(expires).toISOString(),
    );
    return { ok: true };
  });
  route("PATCH", "/api/admin/coupons/([^/]+)", "admin", (ctx) => {
    if (typeof ctx.body.active !== "boolean")
      fail(400, "Active must be true or false.");
    const r = db
      .prepare("UPDATE coupons SET active=? WHERE code=?")
      .run(ctx.body.active ? 1 : 0, ctx.params[0]);
    if (!r.changes) fail(404, "Coupon not found.");
    return { ok: true };
  });

  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(req.method))
          fail(405, "Method not allowed.");
        let requested;
        try {
          requested = decodeURIComponent(url.pathname);
        } catch {
          fail(400, "Invalid path.");
        }
        const root = resolve(publicDir),
          path = resolve(root, `.${requested}`);
        if (
          (path !== root && !path.startsWith(root + sep)) ||
          requested.split("/").some((x) => x.startsWith("."))
        )
          fail(403, "Access denied.");
        let target = path;
        try {
          if (!(await stat(target)).isFile())
            target = resolve(root, "index.html");
        } catch {
          if (extname(path)) fail(404, "File not found.");
          target = resolve(root, "index.html");
        }
        const mime = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".jpg": "image/jpeg",
          ".png": "image/png",
          ".json": "application/json",
          ".txt": "text/plain; charset=utf-8",
        };
        res.setHeader(
          "Content-Type",
          mime[extname(target)] || "application/octet-stream",
        );
        res.setHeader(
          "Cache-Control",
          target.includes(`${sep}assets${sep}`)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
        const bytes = await readFile(target);
        res.writeHead(200);
        res.end(req.method === "HEAD" ? undefined : bytes);
        return;
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      const entry = routes.find(
        (x) => x.method === req.method && x.pattern.test(url.pathname),
      );
      if (!entry) fail(404, "API endpoint not found.");
      let body = {};
      if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        if (req.headers["x-foodlane"] !== "1")
          fail(403, "Request verification failed.");
        const origin = req.headers.origin;
        if (origin) {
          let same = false;
          try {
            same =
              new URL(origin).host === req.headers.host ||
              origin === appOrigin ||
              (!secureCookies && origin === "http://localhost:5173") ||
              (!secureCookies && origin === "http://127.0.0.1:5173");
          } catch {}
          if (!same) fail(403, "Requests from this origin are not allowed.");
        }
        if (
          !String(req.headers["content-type"] || "").startsWith(
            "application/json",
          )
        )
          fail(415, "Send JSON with Content-Type: application/json.");
        let chunks = [],
          bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 65536) fail(413, "Request is too large.");
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString();
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          fail(400, "Request body must contain valid JSON.");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          fail(400, "Request body must be an object.");
      }
      const token =
        (req.headers.cookie || "")
          .split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("foodlane_session="))
          ?.split("=")[1] || "";
      const user = token
        ? db
            .prepare(
              "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
            )
            .get(hash(token), Date.now())
        : null;
      if (entry.role && !user) fail(401, "Please sign in to continue.");
      if (entry.role === "staff" && !["admin", "driver"].includes(user.role))
        fail(403, "Staff access is required.");
      if (
        entry.role &&
        !["any", "staff"].includes(entry.role) &&
        user.role !== entry.role
      )
        fail(403, `${entry.role} access is required.`);
      const ctx = {
        req,
        res,
        url,
        body,
        user,
        token,
        ip: req.socket.remoteAddress || "unknown",
        params: url.pathname.match(entry.pattern).slice(1),
      };
      const result = await entry.fn(ctx);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) logger.error(error);
      if (!res.headersSent) {
        res.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(
          JSON.stringify({
            error:
              status === 500
                ? "Something went wrong. Please try again."
                : error.message,
          }),
        );
      } else res.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}
