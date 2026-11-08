-- D1 schema for /api/event (functions/api/event.js). One row per booking-intent event; no personal data columns.
-- Apply once in the Cloudflare dashboard: Workers & Pages > D1 > ush-events > Console, paste and run.
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY,
  ts           INTEGER NOT NULL,      -- unix seconds
  day          TEXT    NOT NULL,      -- YYYY-MM-DD, Los Angeles
  event        TEXT    NOT NULL,      -- book_click | gift_card_click | call_click | text_click | chat_open | chat_lead | voice_start | lead_submitted | offer_view
  spa          TEXT,                  -- SD | DM | UNSURE
  service      TEXT,                  -- site service id, e.g. lymphatic
  placement    TEXT,                  -- where on the site, e.g. header, sheet, footer, chat
  source       TEXT,                  -- form source, e.g. website-form
  interest     TEXT,                  -- form interest slug
  offer        TEXT,                  -- offer id
  channel      TEXT,                  -- chat | voice | form
  amount       TEXT,                  -- gift card tile: 100 | 150 | ... | couples | custom
  path         TEXT    NOT NULL,      -- site page, e.g. /massage/
  ref          TEXT,                  -- referring host for the visit, e.g. google.com
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT
);
CREATE INDEX IF NOT EXISTS events_day_event ON events (day, event);
CREATE INDEX IF NOT EXISTS events_campaign ON events (utm_campaign, day);
