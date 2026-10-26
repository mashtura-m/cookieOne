# ConsentFlow

A cookie consent management platform (CMP) in the style of Cookiebot and the OneTrust cookie module: scan a website for cookies and trackers, show a banner that follows each visitor's local law, block trackers until consent, send Google Consent Mode v2 signals, and keep proof of every decision.

- **Requirements spec:** [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)
- **Database schema:** [docs/DB_SCHEMA.md](docs/DB_SCHEMA.md) (SQL in [db/migrations](db/migrations))

## What's included

| Part | What it does |
|---|---|
| **Banner script** (`packages/banner`) | One `<script>` tag. Opt-in, opt-out (CCPA "Do Not Sell") and notice banners, preference center, floating settings button, 4 built-in languages, automatic and manual script/iframe blocking, iframe placeholders, Google Consent Mode v2, Global Privacy Control, cookie declaration, `window.ConsentFlow` API. About 11 KB gzipped, rendered in a Shadow DOM. |
| **API** (`apps/api`) | Fastify + PostgreSQL. Accounts, workspaces, roles, invitations, audit log, domains, inventory, versioned banners, geo rules, consent records, CSV export, statistics, compliance checks, and the public embed endpoints. |
| **Scanner** (`apps/scanner`) | Playwright worker. Crawls a site like a first-time visitor (links + sitemap), records cookies, local/session storage, third-party scripts, iframes and pixels, categorizes them from a library of 160+ known cookies and 60+ trackers, and flags tracking set before consent. Runs on demand and on a schedule. |
| **Dashboard** (`apps/dashboard`) | React app: domains, compliance score, consent analytics, scans, cookie and script inventory, banner builder with a live preview per region and language, geo rules with a location tester, consent log with export, settings and install snippets, team and audit log. |
| **WordPress plugin** (`integrations/wordpress`) | Settings page, prints the script first in `<head>`, shortcodes for the declaration and a settings link. |

```mermaid
flowchart LR
  V[Visitor's browser] -- "GET /v1/cmp/:key/cmp.js" --> API
  V -- "POST /v1/consent" --> API
  D[Dashboard] -- "REST + JWT" --> API
  API[API · Fastify] --> PG[(PostgreSQL)]
  W[Scanner · Playwright] --> PG
  W -- crawl --> S[Customer site]
```

## Quick start with Docker

```bash
docker compose up --build
```

Then open http://localhost:5173, create an account and add your domain. The API runs on http://localhost:4000. Migrations and the cookie library seed run automatically when the API starts.

## Local development

Requirements: Node.js 20+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env            # adjust DATABASE_URL if needed
createdb consentflow

npm run build -w @consentflow/banner   # builds cmp.js, which the API serves
npm run dev:api                        # http://localhost:4000 (migrates + seeds on start)
npm run dev:dashboard                  # http://localhost:5173
npm run dev:scanner                    # needs a Chromium for Playwright: npx playwright install chromium
```

The apps read environment variables from the shell; export them or use a tool like `dotenv`. All variables are documented in [.env.example](.env.example).

## Installing the banner on a site

Put this **first** in `<head>`, before Google Tag Manager and other tags, so it can set Consent Mode defaults and block trackers:

```html
<script src="https://YOUR-API/v1/cmp/DOMAIN_KEY/cmp.js"></script>
```

The dashboard shows the exact tag under **Settings & install**.

Block your own tags by hand by changing their type and adding a category:

```html
<script type="text/plain" data-category="statistics" src="https://example.com/analytics.js"></script>
<iframe data-cf-src="https://www.youtube.com/embed/VIDEO_ID" data-category="marketing" width="560" height="315"></iframe>
```

Cookie declaration for your privacy page:

```html
<div id="consentflow-declaration"></div>
```

JavaScript API:

```js
ConsentFlow.getConsent();            // { necessary: true, preferences: false, statistics: true, marketing: false }
ConsentFlow.hasConsent('marketing');
ConsentFlow.showPreferences();       // e.g. from a "Cookie settings" footer link
ConsentFlow.on('change', (c) => { /* ... */ });
window.addEventListener('consentflow:change', (e) => console.log(e.detail));
```

Google Tag Manager users get a `consentflow_update` data layer event on every change, and Consent Mode v2 defaults/updates are pushed automatically. GTM itself (`gtm.js`) is not blocked, so Consent Mode can govern Google tags; other trackers it injects are still blocked by category.

### Geo targeting

The API reads the visitor's country from CDN headers (`CF-IPCountry`, `CloudFront-Viewer-Country`, `X-Vercel-IP-Country`, `X-Country-Code`, …) and the region from the matching region headers. Put the API behind a CDN in production. For testing, append `?cf_country=DE` or `?cf_country=US&cf_region=CA` to the script URL (disable with `ALLOW_GEO_OVERRIDE=false`).

Default rules: GDPR opt-in for the EU, EEA, UK and Switzerland; LGPD opt-in for Brazil; opt-out with GPC for California and other US states with privacy laws; notice-only elsewhere. Edit them per domain under **Geo rules**.

## Tests

```bash
# unit tests (shared logic + banner in jsdom) and API integration tests
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/consentflow_test npm test
npm run typecheck
npm run build
```

The API tests drop and recreate the schema in the test database. CI runs all of this on every push (`.github/workflows/ci.yml`).

The following were also checked by hand against a local test site with a third-party tracker, using a headless browser:

- the scanner found first-party and third-party cookies, local storage, a third-party script, a pixel and an iframe, and categorized `_ga`, `_fbp` and `PHPSESSID` from the library;
- once the tracker was categorized as marketing, its cookie was not set before consent or after Reject all, and was set after Accept all;
- the YouTube iframe was replaced with a placeholder, Consent Mode defaults were `denied`, decisions reached the consent log, returning visitors were not asked again, and withdrawing marketing from the floating button worked.

## Project structure

```
apps/
  api/          Fastify API, migrations runner, seed loader
  dashboard/    React + Vite dashboard
  scanner/      Playwright scan worker
packages/
  banner/       embeddable cmp.js
  shared/       types, translations, geo rules, categorization
db/
  migrations/   SQL schema
  seed/         cookie and tracker library (JSON)
docs/           requirements and schema documentation
integrations/
  wordpress/    WordPress plugin
docker/         Dockerfiles and nginx config
```

## Known limitations

- Iframes in the page HTML that are blocked automatically may start loading before the script removes their `src`. Use `data-cf-src` for embeds you control.
- Scripts that are blocked can still be downloaded by the browser's preload scanner; they do not run and set no cookies until allowed.
- Invitations are shown as links for the admin to send; there is no email provider yet.
- IAB TCF v2.2, GPP and Google CMP certification are not implemented yet (see the roadmap in the requirements spec).
- Default texts and categories are sensible defaults, not legal advice.
