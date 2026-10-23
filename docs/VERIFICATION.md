# Verification record

Verified on 22 October 2026 with Node.js v24.19.0 on Linux.

## Automated integration coverage

`npm test`: **14 tests passed, 0 failed**.

- Customer order with size/sauce customization, coupon, checkout, admin preparation, driver pickup/delivery, chat, review and sales total.
- Order/address/chat ownership and admin/driver role restrictions.
- Idempotent checkout and server-side recomputation after menu price changes.
- Coupon minimums, cap, expiry and first-order-only behavior.
- Cart option/quantity validation, single-restaurant rule and unavailable-item blocking.
- Cancellation limits, sequential status transitions, demo payment state and duplicate-review prevention.
- Disabling simulated payments and progress in standard mode.
- CSRF request/origin checks, logout and anonymous access denial.
- Favorites, order address snapshots and current-price reorder behavior.
- Registration role restrictions, scrypt storage and password-change session revocation.
- Driver assignment before dispatch and assigned-driver permissions.
- Menu/coupon administration and invalid-price rejection.
- Built frontend/static asset serving and private-file denial.
- SQLite persistence after close/reopen without duplicate seed data.

`npm run build` and server syntax checks passed. The generated `dist/` folder is included in the ZIP. All eight food photos are bundled locally.

The final `npm audit` result reported 0 known vulnerabilities across production and development dependencies at verification time. Vite is pinned to 7.3.7. The database backup command was executed successfully.

## Browser checks

The built application was opened in the provided Chrome browser. The desktop layout, restaurant/menu content and food imagery rendered. The food customization dialog was exercised: Large + Garlic mayo + quantity 2 changed the displayed total from ₹249 to ₹688. Authenticated workflows were verified with HTTP integration tests; no claim is made that every authenticated screen was manually exercised in the browser.

Responsive mobile styles, bottom navigation and a cart sheet are implemented. A physical mobile device, mobile viewport and Windows machine were not available for execution testing. The Windows batch scripts use native Node commands and a runtime-version check. Docker configuration is included but was not executed.

## Scope limits

The package contains a real local backend and persisted workflows. It does not contain real payment-provider processing, live GPS, external calling/video, SMS/email notifications, native mobile binaries, automated scheduling/dispatch or a production load/security certification. The route map and test payment are clearly labeled as demonstrations.

The source ZIP excludes generated runtime data, session cookies, `.env`, node_modules, test databases and backups. It includes the source, lockfile, build, images, launch scripts, tests and documentation.
