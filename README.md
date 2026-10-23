# FoodLane · Your next good bite

A complete, locally runnable food delivery application inspired by the supplied orange-and-white mobile UI kit. It includes a responsive React frontend, a Node.js HTTP API, persistent SQLite data, and customer, kitchen-admin and delivery-driver workflows.

**Start here:** install **Node.js 24.x**, extract the ZIP, run **START_WINDOWS.bat**, and open **http://localhost:3000**. The built frontend and all food photos are included. Running the packaged app does **not** require npm installation or an internet connection after Node is installed.

## Included workflows

| Customer | Kitchen admin | Delivery driver |
|---|---|---|
| Sign up, sign in, profile, password change | Order queue and sales totals | Assigned delivery queue |
| Three restaurant menus; search, categories, vegetarian filter | Confirm, prepare and dispatch orders | Confirm pickup and delivery |
| Food size, sauce, quantity, item notes | Assign orders to a driver | Customer and kitchen order chat |
| Persistent cart and favorites | Menu creation, pricing and availability | Delivery address and instructions |
| Coupons and server-calculated totals | Create, enable and disable coupons | Completed delivery history |
| Saved addresses and scheduled delivery request | Read customer messages and reply | Role-restricted order access |
| Cash on delivery or explicit demo payment | Cancel orders with payment-state update | No access to unassigned orders |
| Order timeline, cancellation, chat, reviews and reorder | Restaurant review totals update automatically | No access to menu/admin changes |

Restaurant menus, accounts, addresses, carts, favorites, orders, messages and reviews are stored in SQLite. Closing and restarting the server preserves them. Orders start empty so the first walkthrough is your own.

## Windows quick start

1. Install the official **Node.js 24.x** distribution: https://nodejs.org/.
2. Extract the entire archive to a folder such as `G:\major_projects\foodlane`.
3. Double-click `START_WINDOWS.bat`. Keep that terminal window open.
4. Open http://localhost:3000 in a current Chrome, Edge, Firefox or Safari browser.
5. Select **Sign in**, choose a demo-account button, and submit the sign-in form.

No Python, MongoDB, PostgreSQL, Docker, cloud service, database credentials or API keys are required for the default setup. The server uses Node's built-in SQLite module, avoiding Windows native-package compilation.

| Demo role | Email | Password |
|---|---|---|
| Customer | `customer@foodlane.local` | `Customer123!` |
| Admin | `admin@foodlane.local` | `Admin123!` |
| Driver | `driver@foodlane.local` | `Driver123!` |

These are intentionally public local-demo credentials. Demo mode is enabled by default and binds to your own computer at `127.0.0.1`.

## macOS / Linux

```sh
cd foodlane
bash start.sh
```

Or use `node server/start.mjs` from any platform with Node 24.

## Walk through a full order

1. Sign in as customer. Add a **Classic Smash**, choose **Large** and **Garlic mayo**, and increase quantity to **2**.
2. Apply `WELCOME20`. This first-order coupon takes 20% off, capped at ₹150, with a ₹250 minimum. Two configured burgers have a ₹688 food subtotal; the example total is **₹565.40** after discount and ₹15 packaging, with free delivery.
3. Choose the saved demo address or create your own test address. Choose cash on delivery or the clearly labeled demo payment.
4. Place the order. Its ID, total, items, delivery address and initial event are saved atomically, and the cart clears.
5. In another browser profile or private window, sign in as admin. Open the order. Mark **Confirmed**, **In the kitchen**, then **Ready for pickup**. Assign **Sam Carter**.
6. Sign in as driver using a separate profile, open the assigned delivery, confirm pickup, then mark delivered.
7. As customer, watch the timeline update, send a test message to the kitchen, then leave a restaurant/driver review and reorder.

For a solo recording, use the **Demo** button on the customer order page to advance each status. It is explicitly labeled and can be disabled. All tabs in one browser profile share a session; use separate profiles/windows for simultaneous roles.

## Build and edit the source

The delivered `dist/` folder is ready to run. To edit the React app:

```sh
npm ci
npm run build
npm test
npm start
```

On Windows, `REBUILD_WINDOWS.bat` installs the pinned dependencies, builds the frontend and runs the tests. `node_modules/` is intentionally excluded from the ZIP so Windows installs its own platform binaries.

For live frontend development, use two terminals:

```sh
# Terminal 1 — API + prebuilt app on port 3000
npm start

# Terminal 2 — Vite frontend with API proxy on port 5173
npm run dev:client
```

Open http://localhost:5173. The Vite proxy sends `/api` calls to the backend. Restart the Node process after backend changes. Run `npm run build` when you want the regular port-3000 app to show new frontend changes.

## Configuration and data

Copy `.env.example` to `.env` only when you need to change defaults. Environment variables already present in the process take precedence.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP listening port |
| `HOST` | `127.0.0.1` | Bind address; local only by default |
| `DB_PATH` | `data/foodlane.sqlite` | SQLite path, relative to project root or absolute |
| `DEMO_MODE` | `true` | Seed demo accounts, show simulated payment and demo status controls |
| `SECURE_COOKIES` | `false` | Set `true` behind HTTPS |
| `APP_ORIGIN` | empty | Exact permitted origin, e.g. `https://food.example.com` |

All money is stored as integer paise. A single order contains items from one restaurant. At the sample prices, delivery is free for food subtotals of at least ₹599, otherwise the restaurant delivery fee applies. Packaging is ₹15. These are sample commerce rules; no real tax configuration is included.

The database is created on first start, with schema version 1 recorded in `schema_migrations`. Runtime databases, sessions, test data, backups and `.env` are excluded from the archive.

### Backup and restore

Run `npm run backup` or `node scripts/backup.mjs`. A consistent SQLite backup is created in `backups/` using SQLite's backup API, including when the server is running.

To restore: stop the server; move the current `data/` folder to a safe backup location; create a fresh `data/` folder and copy your backup as `data/foodlane.sqlite`; restart. Do not copy only the live database file while WAL writes are active. Keep backups private because they contain account and order records.

## Docker

```sh
docker compose up --build
```

This uses the included `dist/` build and runs as a non-root user. The container exposes the demo on http://localhost:3000 and keeps data in a named volume. The compose configuration binds the published port to localhost. Rebuild `dist/` before rebuilding the image after a frontend source edit.

The Docker files are supplied but were not executed in this delivery environment. See `docs/DEPLOYMENT.md` for a persistent-server setup and standard-mode account creation.

## Architecture

| Path | Purpose |
|---|---|
| `src/App.jsx` | Customer, admin and driver screens; modals and navigation |
| `src/styles.css` | Responsive desktop/mobile design, focus and print styles |
| `src/api.js` | API client, currency and date formatting |
| `src/icons.jsx` | Local SVG interface icons |
| `server/app.mjs` | HTTP routing, role checks, validation and order workflows |
| `server/db.mjs` | SQLite schema, password helpers and catalog/demo seeding |
| `server/start.mjs` | Environment configuration, static serving and startup |
| `tests/application.test.mjs` | Real-HTTP integration tests against isolated databases |
| `scripts/` | Runtime check, backup and local staff-account provisioning |
| `public/images/` | Bundled food photos and source URLs |
| `dist/` | Ready-built frontend used by the Node server |
| `docs/` | API, deployment, scope and verification notes |

See `docs/API.md` for API examples and route permissions.

## What is live and what is a demo

**Implemented:** authentication, server sessions, role restrictions, persistent data, item customization, totals, discounts, checkout, status transitions, staff dispatch, polling, in-app chat, reviews, favorites, profile/address management and reordering.

**External integrations are not included:** real card/UPI/PayPal charges and refunds, live driver GPS, geocoding, phone/video calls, push notifications, email/SMS delivery, automated delivery dispatch, password-reset email, image uploads, native Android/iOS builds or marketplace-scale operations. A scheduled delivery is a stored request, processed manually by staff. Food photos and business details are illustrative.

The order map is a labeled schematic. Demo payment never accepts or stores payment credentials and never charges money. The call/video-call mockups from the reference are not implemented as fake working controls. This is a functional local full-stack application and a foundation for further commercial integration, not a connected restaurant service.

## Troubleshooting

| Problem | Fix |
|---|---|
| `node` is not recognized | Install Node 24, then reopen the terminal. |
| `node:sqlite` cannot be found | An older Node installation is being used. Check `node --version` and your PATH. |
| Browser cannot connect | Keep `START_WINDOWS.bat` running; use the printed port. |
| Port 3000 already in use | Stop the other process or set `PORT=3001` in `.env`. |
| `vite` is not recognized | Run `npm ci` before a source rebuild; it is not needed for the packaged app. |
| Rollup platform error after copying `node_modules` | Remove that copied folder and run `npm ci` on the target OS. The ZIP contains no `node_modules`. |
| Coupon rejected | Check minimum spend, expiry and first-order eligibility; use `FEAST50` for repeat orders of ₹400+. |
| Driver sees no orders | Admin must assign that driver to an order. |
| Status is not changing | Use staff workflows, or the explicitly labeled demo progress controls. It is not an automatic fake timer. |
| Chat has no automatic response | A real admin/driver session must reply. No chatbot or real courier is connected. |
| Another role appears in an existing tab | Browser tabs share the session cookie. Use separate browser profiles. |
| Frontend edits are not visible | Run `npm run build`, restart and reload, or use `npm run dev:client`. |

## Verification

The integration suite covers a complete customer → admin → driver order, chat, reviews, authorization, price tampering, coupon rules, idempotent checkout, cancellation rules, private data access, cart rules, password/session behavior, admin edits, static-file protection and persistence after a database reopen. See `docs/VERIFICATION.md` for the recorded result and platform limits.

Official references: [Node 24 SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html), [Vite guide](https://vite.dev/guide/), [React](https://react.dev/). Photo source URLs are in `public/images/SOURCES.txt`.
