import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function checkPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function openDatabase(path, { demo = true } = {}) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer','admin','driver')), phone TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS restaurants(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, cuisine TEXT NOT NULL, image TEXT NOT NULL, address TEXT NOT NULL, hours TEXT NOT NULL, eta TEXT NOT NULL, delivery_cents INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS menu(id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id), name TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents>0), image TEXT NOT NULL, vegetarian INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL DEFAULT 1, options TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS addresses(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, label TEXT NOT NULL, recipient TEXT NOT NULL, phone TEXT NOT NULL, line1 TEXT NOT NULL, city TEXT NOT NULL, postcode TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS favorites(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, menu_id TEXT NOT NULL REFERENCES menu(id), PRIMARY KEY(user_id,menu_id));
    CREATE TABLE IF NOT EXISTS cart_items(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, menu_id TEXT NOT NULL REFERENCES menu(id), quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20), size TEXT NOT NULL, sauce TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS coupons(code TEXT PRIMARY KEY, description TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('percent','fixed')), value INTEGER NOT NULL, min_cents INTEGER NOT NULL DEFAULT 0, cap_cents INTEGER NOT NULL, first_only INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id), restaurant_id TEXT NOT NULL REFERENCES restaurants(id), driver_id TEXT REFERENCES users(id), status TEXT NOT NULL, payment_method TEXT NOT NULL, payment_status TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL, delivery_cents INTEGER NOT NULL, packaging_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, coupon_code TEXT, address TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', scheduled_for TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, idempotency_key TEXT NOT NULL, UNIQUE(user_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS order_items(id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), menu_id TEXT NOT NULL REFERENCES menu(id), name TEXT NOT NULL, image TEXT NOT NULL, quantity INTEGER NOT NULL, unit_cents INTEGER NOT NULL, size TEXT NOT NULL, sauce TEXT NOT NULL, note TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS order_events(id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id), status TEXT NOT NULL, created_at TEXT NOT NULL, actor_id TEXT REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id), sender_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id), user_id TEXT NOT NULL REFERENCES users(id), restaurant_id TEXT NOT NULL REFERENCES restaurants(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), driver_rating INTEGER CHECK(driver_rating BETWEEN 1 AND 5), body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS order_user_time ON orders(user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS order_driver ON orders(driver_id,status);
    CREATE INDEX IF NOT EXISTS message_order ON messages(order_id,id);
    CREATE INDEX IF NOT EXISTS cart_user ON cart_items(user_id);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
  `);
  db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES(1,?)").run(now());
  if (!db.prepare("SELECT id FROM restaurants LIMIT 1").get()) seedCatalog(db);
  if (demo) seedDemoUsers(db);
  return db;
}

function seedCatalog(db) {
  db.exec("BEGIN");
  try {
    const restaurants = [
      [
        "ember",
        "Ember & Bun",
        "Big flavors. Better ingredients. Your neighborhood kitchen for flame-grilled burgers, golden wings and seriously good sides.",
        "Burgers · American · Comfort food",
        "burger",
        "18 Rajpur Road, Dehradun",
        "11:00 AM – 11:00 PM",
        "25–35",
        3900,
      ],
      [
        "slice",
        "The Good Slice",
        "Hand-stretched dough, slow-simmered sauce and a little slice of happiness in every box.",
        "Pizza · Italian · Pasta",
        "pizza",
        "42 Chakrata Road, Dehradun",
        "11:00 AM – 10:30 PM",
        "30–40",
        2900,
      ],
      [
        "green",
        "Green Table",
        "Fresh, colorful bowls made with seasonal greens, crunchy toppings and feel-good ingredients.",
        "Healthy · Salads · Bowls",
        "salad",
        "7 Dalanwala, Dehradun",
        "10:00 AM – 10:00 PM",
        "20–30",
        2900,
      ],
    ];
    const insertR = db.prepare(
      "INSERT INTO restaurants(id,name,description,cuisine,image,address,hours,eta,delivery_cents) VALUES(?,?,?,?,?,?,?,?,?)",
    );
    for (const [
      rid,
      name,
      desc,
      cuisine,
      img,
      address,
      hours,
      eta,
      fee,
    ] of restaurants)
      insertR.run(
        rid,
        name,
        desc,
        cuisine,
        `/images/${img}.jpg`,
        address,
        hours,
        eta,
        fee,
      );
    const commonOptions = {
      sizes: [
        { id: "regular", label: "Regular", add_cents: 0 },
        { id: "large", label: "Large", add_cents: 7000 },
      ],
      sauces: [
        { id: "none", label: "No extra sauce", add_cents: 0 },
        { id: "chilli", label: "Sweet chilli", add_cents: 0 },
        { id: "garlic", label: "Garlic mayo", add_cents: 2500 },
        { id: "cheese", label: "Cheese dip", add_cents: 3500 },
      ],
    };
    const rows = [
      [
        "burger-classic",
        "ember",
        "The Classic Smash",
        "Double smashed chicken patty, cheddar, crisp lettuce and our house sauce.",
        "Burgers",
        24900,
        "burger",
        0,
      ],
      [
        "burger-garden",
        "ember",
        "Garden Crunch Burger",
        "Crispy vegetable patty, pickles, lettuce and smoky tomato relish.",
        "Burgers",
        21900,
        "burger",
        1,
      ],
      [
        "wings",
        "ember",
        "Sweet & Spicy Wings",
        "Six golden chicken wings glazed with our signature sweet chilli sauce.",
        "Sides",
        29900,
        "wings",
        0,
      ],
      [
        "fries",
        "ember",
        "Golden Loaded Fries",
        "Crispy fries, a little sea salt and all the comfort you need.",
        "Sides",
        12900,
        "fries",
        1,
      ],
      [
        "salad-house",
        "ember",
        "Fresh Garden Bowl",
        "Mixed greens, cherry tomatoes, cucumber and lemon dressing.",
        "Bowls",
        19900,
        "salad",
        1,
      ],
      [
        "cake",
        "ember",
        "Chocolate Happiness",
        "Rich chocolate cake layered with silky chocolate ganache.",
        "Desserts",
        15900,
        "dessert",
        1,
      ],
      [
        "coffee",
        "ember",
        "Iced Coffee",
        "Freshly brewed coffee, milk and ice. A cool finish to your meal.",
        "Drinks",
        11900,
        "coffee",
        1,
      ],
      [
        "pizza-margherita",
        "slice",
        "Margherita Pizza",
        "Stone-baked pizza with mozzarella, tomato sauce and fresh basil.",
        "Pizza",
        34900,
        "pizza",
        1,
      ],
      [
        "pizza-loaded",
        "slice",
        "Loaded Veggie Pizza",
        "Peppers, mushrooms, olives and mozzarella on our handmade base.",
        "Pizza",
        39900,
        "pizza",
        1,
      ],
      [
        "pasta-pesto",
        "slice",
        "Basil Pesto Pasta",
        "Pasta tossed in fragrant basil pesto with cherry tomatoes.",
        "Pasta",
        27900,
        "pasta",
        1,
      ],
      [
        "slice-cake",
        "slice",
        "Chocolate Slice",
        "Our rich chocolate cake, the perfect pizza-night dessert.",
        "Desserts",
        15900,
        "dessert",
        1,
      ],
      [
        "bowl-super",
        "green",
        "Super Greens Bowl",
        "Seasonal greens, avocado, crunchy vegetables and a citrus dressing.",
        "Bowls",
        27900,
        "salad",
        1,
      ],
      [
        "bowl-pasta",
        "green",
        "Pesto Power Bowl",
        "Pasta, fresh greens, cherry tomatoes and a basil pesto dressing.",
        "Bowls",
        29900,
        "pasta",
        1,
      ],
      [
        "green-coffee",
        "green",
        "Cold Brew Coffee",
        "Smooth, slow-steeped coffee served over ice.",
        "Drinks",
        14900,
        "coffee",
        1,
      ],
    ];
    const insertM = db.prepare(
      "INSERT INTO menu(id,restaurant_id,name,description,category,price_cents,image,vegetarian,options) VALUES(?,?,?,?,?,?,?,?,?)",
    );
    for (const [mid, rid, name, desc, category, price, img, veg] of rows) {
      const opts =
        category === "Drinks" || category === "Desserts"
          ? {
              sizes: [{ id: "regular", label: "Regular", add_cents: 0 }],
              sauces: [{ id: "none", label: "None", add_cents: 0 }],
            }
          : commonOptions;
      insertM.run(
        mid,
        rid,
        name,
        desc,
        category,
        price,
        `/images/${img}.jpg`,
        veg,
        JSON.stringify(opts),
      );
    }
    const expiry = new Date(Date.now() + 365 * 86400000).toISOString();
    db.prepare("INSERT INTO coupons VALUES(?,?,?,?,?,?,?,?,1)").run(
      "WELCOME20",
      "20% off your first order · up to ₹150",
      "percent",
      20,
      25000,
      15000,
      1,
      expiry,
    );
    db.prepare("INSERT INTO coupons VALUES(?,?,?,?,?,?,?,?,1)").run(
      "FEAST50",
      "₹50 off orders of ₹400 or more",
      "fixed",
      5000,
      40000,
      5000,
      0,
      expiry,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function seedDemoUsers(db) {
  const accounts = [
    [
      "customer-demo",
      "Alex Morgan",
      "customer@foodlane.local",
      "Customer123!",
      "customer",
    ],
    [
      "admin-demo",
      "Kitchen Manager",
      "admin@foodlane.local",
      "Admin123!",
      "admin",
    ],
    [
      "driver-demo",
      "Sam Carter",
      "driver@foodlane.local",
      "Driver123!",
      "driver",
    ],
  ];
  for (const [uid, name, email, password, role] of accounts) {
    if (!db.prepare("SELECT id FROM users WHERE email=?").get(email))
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?)").run(
        uid,
        name,
        email,
        hashPassword(password),
        role,
        "9000000000",
        now(),
      );
  }
  if (
    !db.prepare("SELECT id FROM addresses WHERE user_id=?").get("customer-demo")
  )
    db.prepare("INSERT INTO addresses VALUES(?,?,?,?,?,?,?,?,?)").run(
      "demo-home",
      "customer-demo",
      "Home",
      "Alex Morgan",
      "9000000000",
      "12 Rajpur Road, Near Clock Tower",
      "Dehradun",
      "248001",
      "Please ring the doorbell.",
    );
}
