# FoodLane API

Base URL: `http://localhost:3000/api`. JSON responses; errors use `{ "error": "Human-readable message" }`. Routes use exact HTTP methods. IDs are opaque strings; monetary values are integer paise.

## Session and request rules

Authentication uses the HttpOnly `foodlane_session` cookie (7-day expiry, SameSite=Lax). The server stores only a SHA-256 hash of the session token. Passwords are salted with random bytes and hashed with scrypt.

All mutation requests require `Content-Type: application/json` and `X-FoodLane: 1`. Send `{}` for an empty mutation. A supplied Origin must match the host, configured `APP_ORIGIN`, or the local Vite development origin when secure-cookie mode is off. There is no cross-origin CORS permission. Role and order-ownership checks are server-side.

Example in a browser client:

```js
const response = await fetch('/api/cart', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json', 'X-FoodLane': '1' },
  body: JSON.stringify({
    menu_id: 'burger-classic', quantity: 2, size: 'large',
    sauce: 'garlic', note: 'Less spicy, please.'
  })
});
const result = await response.json();
```

## Routes

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/health` | Public | Health/version |
| GET | `/config` | Public | Demo/payment/currency settings |
| POST | `/auth/register` | Public | Customer registration; supplied roles ignored |
| POST | `/auth/login` | Public | Email/password sign-in |
| POST | `/auth/logout` | Signed in | Revoke current session |
| GET | `/auth/me` | Public | Current public user or null |
| PATCH | `/profile` | Signed in | Change name/phone |
| POST | `/profile/password` | Signed in | Change password, revoke other sessions |
| GET | `/restaurants` | Public | Active kitchens and review totals |
| GET | `/restaurants/:id` | Public | Kitchen, menu and latest 100 reviews |
| GET | `/menu?q=…` | Public | Menu with optional search |
| GET | `/favorites` | Customer | Saved items |
| POST/DELETE | `/favorites/:menuId` | Customer | Save/remove a favorite |
| GET/POST | `/addresses` | Customer | List/create own addresses |
| PATCH/DELETE | `/addresses/:id` | Customer | Change/remove own address |
| GET/POST/DELETE | `/cart` | Customer | Read/add/clear own cart |
| PATCH/DELETE | `/cart/:id` | Customer | Quantity update/remove line |
| POST | `/cart/quote` | Customer | Validate coupon and recalculate totals |
| GET | `/coupons` | Customer | Active unexpired coupons |
| GET/POST | `/orders` | Role-scoped/customer | List orders/create an order |
| GET | `/orders/:id` | Owner/admin/assigned driver | Full order, items, events and review |
| POST | `/orders/:id/cancel` | Owner/admin | Cancel within permitted states |
| PATCH | `/orders/:id/status` | Admin/assigned driver | Next permitted status |
| POST | `/orders/:id/demo-advance` | Owner, demo only | Explicitly simulate next stage |
| POST | `/orders/:id/reorder` | Owner | Recreate cart at current prices |
| GET/POST | `/orders/:id/messages` | Owner/admin/assigned driver | Read/send order chat |
| POST | `/orders/:id/review` | Owner | One review after delivery |
| GET | `/admin/stats` | Admin | Counts and delivered revenue |
| GET | `/admin/drivers` | Admin | Available driver accounts |
| PATCH | `/admin/orders/:id/driver` | Admin | Assign driver |
| POST | `/admin/menu` | Admin | Create a menu item |
| PATCH | `/admin/menu/:id` | Admin | Name, description, price and availability |
| GET/POST | `/admin/coupons` | Admin | List/create offers |
| PATCH | `/admin/coupons/:code` | Admin | Enable/disable an offer |

## Common request bodies

```json
{"name":"Alex Example","email":"alex@example.test","password":"ChooseYourOwnLongPassword"}
```

```json
{"label":"Home","recipient":"Alex Example","phone":"9000000000","line1":"12 Example Road","city":"Dehradun","postcode":"248001","instructions":"Ring the bell"}
```

```json
{"coupon":"WELCOME20"}
```

```json
{"address_id":"returned-address-id","payment_method":"cod","coupon":"WELCOME20","instructions":"Please ring the bell","scheduled_for":null,"idempotency_key":"unique-client-generated-key-at-least-8-chars"}
```

```json
{"status":"preparing"}
```

```json
{"rating":5,"driver_rating":5,"body":"A delicious meal!"}
```

`scheduled_for` must be an ISO timestamp at least 30 minutes ahead and within seven days. `payment_method` is `cod` or, only with demo mode enabled, `demo`. `idempotency_key` is required: retry the exact checkout with the same key to receive the same saved order. After a completed checkout, generate a new key for a new order.

## State machine and business rules

`placed → accepted → preparing → ready → out_for_delivery → delivered`

Transitions cannot be skipped. Dispatch requires an assigned driver. Drivers can only transition an assigned ready order to out_for_delivery and then delivered. A customer can cancel while placed or accepted; an admin may cancel any nonterminal order. Delivered and cancelled are terminal. The demo-advance endpoint is absent behaviorally (404) when demo mode is disabled.

Cash on delivery is `unpaid` until delivered, then `collected`. Simulated payment is `demo_paid`; cancellation changes it to `demo_refunded`, without a real processor call.

Checkout runs inside one transaction. Prices/options/availability and coupon conditions are recalculated from database values. Client totals are ignored. The delivery address and item prices/names are snapshotted, so later profile/menu changes do not rewrite historical orders. Reordering uses current prices and availability and requires `replace: true` to replace a nonempty cart.

Limits: 64 KiB JSON request bodies, 40 distinct cart lines, quantity 1–20 per line, 20 saved addresses, 1000 characters per chat/review. Authentication and messages have in-process rate limits. Orders are capped at the latest 100 per customer/driver and latest 300 in the admin list; no pagination UI is included.

Typical status codes: 400 validation, 401 sign-in required, 403 access denied, 404 not found, 409 business-rule conflict, 413 body too large, 415 unsupported request type, 429 rate limited. Successful application routes return 200.
