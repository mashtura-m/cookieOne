# ConsentFlow database schema

PostgreSQL 14+ (developed on 16). The source of truth is [`db/migrations/001_init.sql`](../db/migrations/001_init.sql); migrations run automatically when the API starts (`AUTO_MIGRATE=true`) or with `npm run db:migrate`.

## Entity relationships

```mermaid
erDiagram
  organizations ||--o{ memberships : has
  users ||--o{ memberships : has
  organizations ||--o{ invitations : sends
  organizations ||--o{ domains : owns
  organizations ||--o{ audit_log : records
  domains ||--o{ scans : "is scanned by"
  scans ||--o{ scan_pages : visits
  scans ||--o{ scan_findings : finds
  domains ||--o{ domain_cookies : declares
  domains ||--o{ domain_scripts : blocks
  cookie_library ||--o{ domain_cookies : "categorizes"
  domains ||--o{ banner_configs : "has versions"
  domains ||--o{ geo_rules : applies
  domains ||--o{ consent_records : collects
  domains ||--o{ banner_impressions : counts

  organizations { uuid id PK; text name; text plan }
  users { uuid id PK; citext email UK; text name; text password_hash }
  memberships { uuid org_id PK; uuid user_id PK; member_role role }
  invitations { uuid id PK; uuid org_id FK; citext email; member_role role; text token UK; timestamptz expires_at }
  domains { uuid id PK; uuid org_id FK; text hostname; text public_key UK; int consent_expiry_days; text scan_frequency }
  cookie_library { int id PK; text name_pattern; bool is_regex; text vendor; text provider_domain; consent_category category }
  vendor_scripts { int id PK; text url_pattern UK; text vendor; consent_category category }
  scans { uuid id PK; uuid domain_id FK; scan_status status; int page_limit; text locked_by }
  scan_pages { bigint id PK; uuid scan_id FK; text url; int status_code }
  scan_findings { bigint id PK; uuid scan_id FK; finding_kind kind; text name; consent_category category; bool set_before_consent }
  domain_cookies { uuid id PK; uuid domain_id FK; finding_kind kind; text name; text provider_domain; consent_category category; bool is_overridden }
  domain_scripts { uuid id PK; uuid domain_id FK; text url_pattern; consent_category category; bool is_overridden }
  banner_configs { uuid id PK; uuid domain_id FK; int version; banner_status status; jsonb theme; jsonb texts }
  geo_rules { uuid id PK; uuid domain_id FK; regulation regulation; consent_model model; text_array regions; int priority }
  consent_records { bigint id PK; uuid domain_id FK; uuid consent_id; consent_action action; bool marketing; int banner_version }
  banner_impressions { uuid domain_id PK; date day PK; char country PK; int count }
  audit_log { bigint id PK; uuid org_id FK; uuid user_id FK; text action; jsonb details }
```

## Enum types

| Type | Values |
|---|---|
| `member_role` | owner, admin, editor, viewer |
| `consent_category` | necessary, preferences, statistics, marketing, unclassified |
| `regulation` | gdpr, ccpa, lgpd, none |
| `consent_model` | opt_in, opt_out, notice |
| `scan_status` | queued, running, completed, failed |
| `scan_trigger` | manual, scheduled, api |
| `finding_kind` | cookie, local_storage, session_storage, script, iframe, pixel |
| `item_source` | scan, manual, library |
| `banner_status` | draft, published, archived |
| `consent_action` | accept_all, reject_all, custom, withdraw, gpc_opt_out, implied |

## Tables

### Tenancy and identity

**organizations**: a workspace. `plan` is reserved for billing.

**users**: `email` is `citext`, so uniqueness ignores case. `password_hash` has the form `scrypt$<salt>$<key>` (base64).

**memberships**: links users to organizations with a role. Primary key `(org_id, user_id)`.

**invitations**: single-use `token`, valid until `expires_at` (7 days). `accepted_at` is set when used.

### Domains

**domains**: one website. `public_key` is the random identifier in the embed URL (rotatable). `extra_hostnames` lists aliases whose consent posts are accepted. Settings columns: `scan_page_limit`, `scan_frequency`, `consent_expiry_days`, `privacy_policy_url`, `google_consent_mode`, `auto_block`. Unique `(org_id, hostname)`.

### Global knowledge base

Shared by all customers and loaded from `db/seed/*.json` (upserted on every API start).

**cookie_library**: known cookies. `name_pattern` is an exact name, or a regular expression when `is_regex` (always matched against the whole name). `provider_domain` binds a pattern to a third-party domain (e.g. `IDE` on `doubleclick.net`); `NULL` means it can match on any domain, which covers first-party tags like `_ga`. Unique `(name_pattern, vendor)`.

**vendor_scripts**: known tracker URLs (`url_pattern` is a host or host/path substring) and their category. Used by the scanner to categorize and by the banner to block automatically.

### Scanning

**scans**: one scan run and also the job queue. Workers claim the oldest queued row with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, so many workers can run safely. Partial index `scans_queue_idx` on `queued_at WHERE status = 'queued'` keeps claiming fast.

**scan_pages**: every URL visited, with HTTP status or error.

**scan_findings**: what one scan saw, already categorized. `set_before_consent` is true for everything the scanner sees, because it never interacts with a banner; the compliance check counts tracking cookies among them. `attributes` holds cookie flags (`expires`, `secure`, `httpOnly`, `sameSite`, `domain`, `path`). Unique `(scan_id, kind, name, provider_domain)`.

### Inventory (what the banner declares and blocks)

**domain_cookies**: the cookie declaration for a domain. `provider_domain` is `''` for first-party items so the unique key `(domain_id, kind, name, provider_domain)` works without NULL handling. `is_overridden` is set whenever a person edits a row; scans then only update `last_seen_at`. `library_id` links to the library entry used.

**domain_scripts**: blocking rules per domain. Scanned scripts are stored by library pattern when known, otherwise by host. Rules with category `necessary` also stop the global library from blocking that pattern; `unclassified` rules are shown but not enforced.

### Banner and rules

**banner_configs**: versioned banner settings. At most one `draft` and one `published` row per domain (partial unique indexes). Publishing archives the old published row and promotes the draft; the `version` number goes into every visitor's consent cookie, so a new version re-prompts. `theme` and `texts` are JSON (`texts` is keyed by language code with partial overrides of the built-in translations).

**geo_rules**: which regulation and consent model apply where. `regions` holds ISO 3166-1 alpha-2 codes, subdivision codes such as `US-CA`, or `*`. Resolution logic lives in `packages/shared/src/regions.ts`.

### Consent evidence

**consent_records**: append-only proof of consent. One row per decision. Stores the three optional categories as booleans (necessary is always true), the banner version and regulation in force, location from CDN headers, a truncated IP and the user agent. Indexes:

- `(domain_id, created_at DESC)` for the dashboard list and statistics,
- `(domain_id, consent_id)` for looking up one visitor,
- BRIN on `created_at` for cheap range scans over very large tables.

**banner_impressions**: one counter per domain, day and country (`'--'` when unknown), upserted on each banner display. Used to compute interaction and consent rates without storing a row per page view.

### Audit

**audit_log**: dashboard changes (`action` like `banner.published`, `cookie.updated`, `member.invited`) with JSON `details`.

## Deletion behavior

Deleting an organization deletes its memberships, invitations, domains and audit log. Deleting a domain deletes its scans, findings, inventory, banner versions, geo rules, consent records and impressions (`ON DELETE CASCADE`). Deleting a user keeps their history but nulls the reference (`ON DELETE SET NULL`).

## Scaling notes

- **Consent records** grow fastest (one row per decision across all customer sites). When the table reaches hundreds of millions of rows: convert it to a table partitioned by month on `created_at` (the primary key becomes `(id, created_at)`), detach old partitions to cold storage according to the retention policy, and stream new rows to a column store (ClickHouse or BigQuery) for analytics.
- **Impressions** are already pre-aggregated; at very high traffic, buffer increments in Redis and flush every few seconds.
- **The embed endpoint** reads only `domains`, the published `banner_configs`, `geo_rules`, `domain_cookies`, `domain_scripts` and `vendor_scripts`, cached in API memory for 30 seconds. With a CDN in front (cache key = URL + country + region), the database sees almost none of the page-view traffic.
