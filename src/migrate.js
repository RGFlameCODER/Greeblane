import dotenv from "dotenv";
dotenv.config();
import { pool } from "./db.js";

const schema = `
CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  global_name TEXT,
  avatar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS applications (
  id BIGSERIAL PRIMARY KEY,
  discord_id TEXT NOT NULL REFERENCES users(discord_id),
  application_type TEXT NOT NULL CHECK (application_type IN ('whitelist','ems','police')),
  applicant_name TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 16 AND age <= 99),
  experience TEXT NOT NULL,
  answer_one TEXT NOT NULL,
  answer_two TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','approved','rejected','changes_requested')),
  reviewer_discord_id TEXT,
  reviewer_notes TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS applications_status_idx ON applications(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS applications_discord_idx ON applications(discord_id, submitted_at DESC);
CREATE TABLE IF NOT EXISTS site_rules (
  rule_key TEXT PRIMARY KEY CHECK (rule_key IN ('discord','city')),
  rules JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_discord_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions(expire);
INSERT INTO site_rules(rule_key, rules) VALUES
('discord', '[
  "Respect all members. Harassment, hate speech, discrimination and targeted abuse are not allowed.",
  "No spam, flooding, unsolicited advertising or malicious links.",
  "Use the correct channels and follow reasonable staff instructions.",
  "Do not publish private information or private conversations without permission.",
  "Use support and report channels appropriately. Do not argue about punishments in public chat.",
  "Do not impersonate staff or mislead members about your role."
]'::jsonb),
('city', '[
  "Value of Life: treat credible threats seriously and roleplay believable reactions.",
  "No RDM or VDM: do not attack or run over players without valid roleplay grounds.",
  "No metagaming or powergaming. Keep out-of-character information out of character.",
  "Follow the official New Life Rule and respawn/memory rules published by Greenlane RP.",
  "No combat logging, exploiting, cheating or abusing bugs. Report bugs to staff.",
  "Use clear roleplay initiation and follow department, gang, robbery and safe-zone rules.",
  "Respect staff decisions and use the published appeal process."
]'::jsonb)
ON CONFLICT (rule_key) DO NOTHING;
`;

try {
  await pool.query(schema);
  console.log("Greenlane RP database migration completed.");
} catch (error) {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
