-- ConsentFlow initial schema
-- PostgreSQL 14+

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE member_role       AS ENUM ('owner', 'admin', 'editor', 'viewer');
CREATE TYPE consent_category  AS ENUM ('necessary', 'preferences', 'statistics', 'marketing', 'unclassified');
CREATE TYPE regulation        AS ENUM ('gdpr', 'ccpa', 'lgpd', 'none');
CREATE TYPE consent_model     AS ENUM ('opt_in', 'opt_out', 'notice');
CREATE TYPE scan_status       AS ENUM ('queued', 'running', 'completed', 'failed');
CREATE TYPE scan_trigger      AS ENUM ('manual', 'scheduled', 'api');
CREATE TYPE finding_kind      AS ENUM ('cookie', 'local_storage', 'session_storage', 'script', 'iframe', 'pixel');
CREATE TYPE item_source       AS ENUM ('scan', 'manual', 'library');
CREATE TYPE banner_status     AS ENUM ('draft', 'published', 'archived');
CREATE TYPE consent_action    AS ENUM ('accept_all', 'reject_all', 'custom', 'withdraw', 'gpc_opt_out', 'implied');

-- ---------------------------------------------------------------------------
-- Tenancy & identity
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  plan        text NOT NULL DEFAULT 'free',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL UNIQUE,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE memberships (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        member_role NOT NULL DEFAULT 'editor',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email        citext NOT NULL,
  role         member_role NOT NULL DEFAULT 'editor',
  token        text NOT NULL UNIQUE,
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_org_idx ON invitations(org_id);

-- ---------------------------------------------------------------------------
-- Domains (one website = one domain)
-- ---------------------------------------------------------------------------
CREATE TABLE domains (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  hostname             text NOT NULL,
  public_key           text NOT NULL UNIQUE,          -- used in the embed script URL
  extra_hostnames      text[] NOT NULL DEFAULT '{}',  -- aliases that share the same consent
  scan_page_limit      integer NOT NULL DEFAULT 50 CHECK (scan_page_limit BETWEEN 1 AND 5000),
  scan_frequency       text NOT NULL DEFAULT 'monthly' CHECK (scan_frequency IN ('off', 'weekly', 'monthly')),
  consent_expiry_days  integer NOT NULL DEFAULT 365 CHECK (consent_expiry_days BETWEEN 1 AND 730),
  privacy_policy_url   text,
  google_consent_mode  boolean NOT NULL DEFAULT true,
  auto_block           boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, hostname)
);

-- ---------------------------------------------------------------------------
-- Global knowledge base (shared across all customers)
-- ---------------------------------------------------------------------------
CREATE TABLE cookie_library (
  id               serial PRIMARY KEY,
  name_pattern     text NOT NULL,             -- exact name, or a regex when is_regex
  is_regex         boolean NOT NULL DEFAULT false,
  vendor           text NOT NULL,
  provider_domain  text,                      -- e.g. google-analytics.com; NULL = first party
  category         consent_category NOT NULL,
  purpose          text NOT NULL,
  retention        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name_pattern, vendor)
);

CREATE TABLE vendor_scripts (
  id           serial PRIMARY KEY,
  vendor       text NOT NULL,
  url_pattern  text NOT NULL UNIQUE,          -- host or host/path substring
  category     consent_category NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Scanning (the scans table doubles as the worker job queue)
-- ---------------------------------------------------------------------------
CREATE TABLE scans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id      uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  status         scan_status NOT NULL DEFAULT 'queued',
  trigger        scan_trigger NOT NULL DEFAULT 'manual',
  requested_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  page_limit     integer NOT NULL,
  pages_scanned  integer NOT NULL DEFAULT 0,
  cookies_found  integer NOT NULL DEFAULT 0,
  new_items      integer NOT NULL DEFAULT 0,
  error          text,
  locked_by      text,
  queued_at      timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
CREATE INDEX scans_queue_idx  ON scans(queued_at) WHERE status = 'queued';
CREATE INDEX scans_domain_idx ON scans(domain_id, queued_at DESC);

CREATE TABLE scan_pages (
  id           bigserial PRIMARY KEY,
  scan_id      uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  url          text NOT NULL,
  status_code  integer,
  error        text,
  scanned_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scan_pages_scan_idx ON scan_pages(scan_id);

CREATE TABLE scan_findings (
  id                    bigserial PRIMARY KEY,
  scan_id               uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  kind                  finding_kind NOT NULL,
  name                  text NOT NULL,          -- cookie/storage key, or script/iframe URL
  provider_domain       text,
  first_seen_url        text,
  category              consent_category NOT NULL DEFAULT 'unclassified',
  vendor                text,
  attributes            jsonb NOT NULL DEFAULT '{}',  -- expires, secure, httpOnly, sameSite
  set_before_consent    boolean NOT NULL DEFAULT true,
  UNIQUE (scan_id, kind, name, provider_domain)
);
CREATE INDEX scan_findings_scan_idx ON scan_findings(scan_id);

-- ---------------------------------------------------------------------------
-- Per-domain inventory: what the banner declares and blocks
-- ---------------------------------------------------------------------------
CREATE TABLE domain_cookies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id        uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  kind             finding_kind NOT NULL DEFAULT 'cookie'
                   CHECK (kind IN ('cookie', 'local_storage', 'session_storage', 'pixel')),
  name             text NOT NULL,
  provider_domain  text NOT NULL DEFAULT '',   -- '' = first party (keeps UNIQUE simple)
  category         consent_category NOT NULL DEFAULT 'unclassified',
  vendor           text,
  purpose          text,
  retention        text,
  library_id       integer REFERENCES cookie_library(id) ON DELETE SET NULL,
  source           item_source NOT NULL DEFAULT 'scan',
  is_overridden    boolean NOT NULL DEFAULT false,  -- edited by a human: scans never overwrite
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain_id, kind, name, provider_domain)
);
CREATE INDEX domain_cookies_domain_idx ON domain_cookies(domain_id, category);

CREATE TABLE domain_scripts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id      uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  url_pattern    text NOT NULL,
  category       consent_category NOT NULL DEFAULT 'unclassified',
  vendor         text,
  source         item_source NOT NULL DEFAULT 'scan',
  is_overridden  boolean NOT NULL DEFAULT false,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain_id, url_pattern)
);

-- ---------------------------------------------------------------------------
-- Banner configuration (versioned; publishing a new version re-prompts visitors)
-- ---------------------------------------------------------------------------
CREATE TABLE banner_configs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id            uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  version              integer NOT NULL,
  status               banner_status NOT NULL DEFAULT 'draft',
  layout               text NOT NULL DEFAULT 'box' CHECK (layout IN ('bar', 'box', 'popup')),
  position             text NOT NULL DEFAULT 'bottom-left'
                       CHECK (position IN ('bottom', 'top', 'bottom-left', 'bottom-right', 'center')),
  theme                jsonb NOT NULL DEFAULT '{}',
  texts                jsonb NOT NULL DEFAULT '{}',   -- { "en": { "title": "...", ... }, "de": {...} }
  languages            text[] NOT NULL DEFAULT '{en}',
  default_language     text NOT NULL DEFAULT 'en',
  show_reject_all      boolean NOT NULL DEFAULT true,
  show_floating_button boolean NOT NULL DEFAULT true,
  custom_css           text NOT NULL DEFAULT '',
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  published_at         timestamptz,
  UNIQUE (domain_id, version)
);
-- At most one draft and one published config per domain
CREATE UNIQUE INDEX banner_one_draft     ON banner_configs(domain_id) WHERE status = 'draft';
CREATE UNIQUE INDEX banner_one_published ON banner_configs(domain_id) WHERE status = 'published';

-- ---------------------------------------------------------------------------
-- Geo rules: which regulation applies where
-- ---------------------------------------------------------------------------
CREATE TABLE geo_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id   uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  name        text NOT NULL,
  regulation  regulation NOT NULL,
  model       consent_model NOT NULL,
  regions     text[] NOT NULL,              -- ISO 3166 'DE', subdivision 'US-CA', or '*'
  honor_gpc   boolean NOT NULL DEFAULT true,
  priority    integer NOT NULL DEFAULT 0,   -- higher wins when regions overlap
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX geo_rules_domain_idx ON geo_rules(domain_id);

-- ---------------------------------------------------------------------------
-- Consent records (proof of consent, append-only, high volume)
-- ---------------------------------------------------------------------------
CREATE TABLE consent_records (
  id              bigserial PRIMARY KEY,
  domain_id       uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  consent_id      uuid NOT NULL,                -- pseudonymous visitor id stored in the consent cookie
  action          consent_action NOT NULL,
  preferences     boolean NOT NULL,
  statistics      boolean NOT NULL,
  marketing       boolean NOT NULL,
  banner_version  integer NOT NULL,
  regulation      regulation NOT NULL,
  country         char(2),
  region          text,
  ip_truncated    text,                         -- last IPv4 octet / IPv6 last 80 bits zeroed
  user_agent      text,
  page_url        text,
  gpc             boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_records_domain_time_idx ON consent_records(domain_id, created_at DESC);
CREATE INDEX consent_records_consent_id_idx  ON consent_records(domain_id, consent_id);
CREATE INDEX consent_records_time_brin       ON consent_records USING brin(created_at);

-- Banner impressions, pre-aggregated per day (needed for consent rate)
CREATE TABLE banner_impressions (
  domain_id  uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  day        date NOT NULL,
  country    char(2) NOT NULL DEFAULT '--',
  count      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (domain_id, day, country)
);

-- ---------------------------------------------------------------------------
-- Audit log (who changed what in the dashboard)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  domain_id   uuid REFERENCES domains(id) ON DELETE SET NULL,
  action      text NOT NULL,
  details     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_idx ON audit_log(org_id, created_at DESC);
