# Running beyond localhost

The delivered system is a Node.js server with a local SQLite database. It needs a long-running Node 24 process and durable disk. A static-only upload of `dist/` will show a frontend but will not provide authentication, orders or persistence. Standard serverless filesystems are not a replacement for the database disk.

## Single-server setup

1. Provision a host that can run Node 24 and keep a private data directory across restarts.
2. Copy the application, including `dist/`, `server/`, `scripts/` and `package.json`.
3. Start from a **new database path** and set:

```dotenv
HOST=127.0.0.1
PORT=3000
DB_PATH=data/foodlane-standard.sqlite
DEMO_MODE=false
SECURE_COOKIES=true
APP_ORIGIN=https://food.example.com
```

4. Create staff accounts locally with `node scripts/create-user.mjs`. It prompts for a name, email, role and password. Public registration only creates customer accounts. Use a private terminal: the CLI clearly indicates that its password input is visible.
5. Run `node server/start.mjs` under a process supervisor. Put an HTTPS reverse proxy on the same host in front of it. Preserve the original Host header or set the exact public `APP_ORIGIN`; do not expose the SQLite/data directory as static files.
6. Use the backup script and verify your operational restore process. Configure your host's firewall, TLS certificates, log retention and monitoring.

`DEMO_MODE=false` refuses to start with a database that still contains the seeded demo account IDs. This prevents accidental public exposure of the known demo credentials. A fresh database still contains the sample restaurant catalog, so replace the business data before real use. The provided app does not yet expose restaurant metadata editing in the admin UI.

## Container notes

The supplied Dockerfile uses the prebuilt frontend and has no runtime npm dependency installation. Compose uses persistent named volumes and a localhost-only published port. For a non-demo container, change `DEMO_MODE`, use a separate data volume, set HTTPS cookie/origin values, and run the staff-account CLI in that container before exposing it. Secure cookies require HTTPS at the browser, even if the proxy-to-Node connection is HTTP.

Docker execution was not available as part of the delivery verification. The native Node server is the verified run path.

## Integrations still required for a commercial service

- Payment provider checkout, signed webhook verification, reconciliation, refunds and dispute handling.
- A map/geocoding provider, driver location publishing, consent and retention policy for location data.
- Real restaurant onboarding, service-area validation, opening-hours enforcement, inventory, taxes and jurisdiction-specific receipts.
- Email verification, email password recovery, MFA where needed, customer support and notification delivery.
- Monitoring, abuse prevention, durable rate limits, load testing and security review.
- Larger deployments should replace synchronous SQLite operations with a suitable database/application architecture. In-memory rate limiting assumes one Node process; it is not a distributed enforcement system.

No commercial readiness or traffic capacity has been claimed. The package is a full local workflow implementation and an integration starting point.
