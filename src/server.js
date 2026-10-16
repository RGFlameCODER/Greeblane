import dotenv from "dotenv";
dotenv.config();
import "express-async-errors";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "./db.js";
import { exchangeCode, getDiscordConfig, getPermissions, oauthConfigured, sendApplicationNotification } from "./discord.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const isProduction = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 3000);
const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
const PgStore = connectPgSimple(session);

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET must be set to a random value at least 32 characters long.");
  process.exit(1);
}
if (isProduction && !baseUrl.startsWith("https://")) {
  console.error("In production, BASE_URL must use https://");
  process.exit(1);
}
app.set("trust proxy", isProduction ? 1 : false);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "40kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(session({
  store: new PgStore({ pool, tableName: "user_sessions", createTableIfMissing: false }),
  name: "glrp.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
app.use("/auth/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"], maxAge: isProduction ? "1h" : 0 }));

const TYPES = new Set(["whitelist", "ems", "police"]);
const STATUSES = new Set(["pending", "in_review", "approved", "rejected", "changes_requested"]);
const DEFAULT_RULES = {
  discord: [
    "Respect all members. Harassment, hate speech, discrimination and targeted abuse are not allowed.",
    "No spam, flooding, unsolicited advertising or malicious links.",
    "Use the correct channels and follow reasonable staff instructions.",
    "Do not publish private information or private conversations without permission.",
    "Use support and report channels appropriately. Do not argue about punishments in public chat.",
    "Do not impersonate staff or mislead members about your role."
  ],
  city: [
    "Value of Life: treat credible threats seriously and roleplay believable reactions.",
    "No RDM or VDM: do not attack or run over players without valid roleplay grounds.",
    "No metagaming or powergaming. Keep out-of-character information out of character.",
    "Follow the official New Life Rule and respawn/memory rules published by Greenlane RP.",
    "No combat logging, exploiting, cheating or abusing bugs. Report bugs to staff.",
    "Use clear roleplay initiation and follow department, gang, robbery and safe-zone rules.",
    "Respect staff decisions and use the published appeal process."
  ]
};
function csrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  return req.session.csrfToken;
}
function checkCsrf(req, res, next) {
  const token = req.get("x-csrf-token") || req.body?._csrf;
  const supplied = Buffer.from(String(token || ""));
  const expected = Buffer.from(String(req.session.csrfToken || ""));
  if (!token || !req.session.csrfToken || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return res.status(403).json({ error: "Security token expired. Refresh the page and try again." });
  }
  next();
}
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Sign in with Discord first." });
  next();
}
async function requireMember(req, res, next) {
  try {
    const perms = await getPermissions(req.session.user.id);
    if (!perms.isMember) return res.status(403).json({ error: "Join the Greenlane RP Discord server before continuing." });
    req.permissions = perms;
    next();
  } catch {
    res.status(503).json({ error: "Could not verify Discord server membership. Try again shortly." });
  }
}
async function requireStaff(req, res, next) {
  try {
    const perms = await getPermissions(req.session.user.id);
    if (!perms.isStaff) return res.status(403).json({ error: "You do not have the required Greenlane RP staff role." });
    req.permissions = perms;
    next();
  } catch {
    res.status(503).json({ error: "Could not verify staff permissions with Discord." });
  }
}
async function requireRulesAdmin(req, res, next) {
  try {
    const perms = await getPermissions(req.session.user.id);
    if (!perms.canEditRules) return res.status(403).json({ error: "You do not have permission to edit website rules." });
    req.permissions = perms;
    next();
  } catch {
    res.status(503).json({ error: "Could not verify staff permissions with Discord." });
  }
}
async function audit(actor, action, targetType, targetId = null, details = {}) {
  await query("INSERT INTO audit_log(actor_discord_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",
    [actor, action, targetType, targetId == null ? null : String(targetId), JSON.stringify(details)]);
}
function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

app.get("/api/config", async (_req, res) => {
  const rulesResult = await query("SELECT rule_key, rules FROM site_rules ORDER BY rule_key");
  const rules = { ...DEFAULT_RULES };
  for (const row of rulesResult.rows) rules[row.rule_key] = row.rules;
  res.json({
    siteName: process.env.SITE_NAME || "GREENLANE RP",
    discordInviteUrl: getDiscordConfig().inviteUrl,
    oauthConfigured: oauthConfigured(),
    rules
  });
});
app.get("/api/session", async (req, res) => {
  let permissions = { isMember: false, isStaff: false, canEditRules: false };
  if (req.session.user) {
    try { permissions = await getPermissions(req.session.user.id); }
    catch { /* UI still loads; protected endpoints fail closed */ }
  }
  res.json({
    user: req.session.user ? {
      id: req.session.user.id,
      username: req.session.user.username,
      globalName: req.session.user.globalName,
      avatar: req.session.user.avatar
    } : null,
    permissions,
    csrfToken: csrfToken(req)
  });
});
app.get("/auth/discord", (req, res) => {
  if (!oauthConfigured()) return res.status(503).send("Discord OAuth is not configured. Follow README.md setup steps.");
  const c = getDiscordConfig();
  const state = crypto.randomBytes(32).toString("hex");
  req.session.oauthState = state;
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", c.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", c.redirectUri);
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});
app.get("/auth/discord/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect("/?auth=cancelled");
    const suppliedState = Buffer.from(String(state || ""));
    const expectedState = Buffer.from(String(req.session.oauthState || ""));
    if (!code || !state || !req.session.oauthState || suppliedState.length !== expectedState.length || !crypto.timingSafeEqual(suppliedState, expectedState)) {
      return res.status(400).send("Invalid OAuth state. Please start Discord login again.");
    }
    delete req.session.oauthState;
    const user = await exchangeCode(String(code));
    await query(`INSERT INTO users(discord_id,username,global_name,avatar,last_login_at)
      VALUES($1,$2,$3,$4,NOW())
      ON CONFLICT(discord_id) DO UPDATE SET username=EXCLUDED.username,global_name=EXCLUDED.global_name,avatar=EXCLUDED.avatar,last_login_at=NOW()`,
      [user.id, user.username, user.global_name || null, user.avatar || null]);
    req.session.regenerate((err) => {
      if (err) return res.status(500).send("Could not start secure session.");
      req.session.user = { id: user.id, username: user.username, globalName: user.global_name || user.username, avatar: user.avatar || null };
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).send("Could not save session.");
        res.redirect("/");
      });
    });
  } catch (error) {
    console.error("Discord OAuth callback failed:", error.message);
    res.status(502).send("Discord sign-in failed. Please return to the website and try again.");
  }
});
app.post("/auth/logout", requireLogin, checkCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("glrp.sid", { httpOnly: true, secure: isProduction, sameSite: "lax" });
    res.json({ ok: true });
  });
});

app.get("/api/applications", requireLogin, requireMember, async (req, res) => {
  const result = await query(
    "SELECT id,application_type,applicant_name,age,experience,answer_one,answer_two,availability,status,reviewer_notes,submitted_at,updated_at FROM applications WHERE discord_id=$1 ORDER BY submitted_at DESC LIMIT 50",
    [req.session.user.id]
  );
  res.json({ applications: result.rows });
});
app.post("/api/applications", requireLogin, requireMember, checkCsrf, async (req, res) => {
  const body = req.body || {};
  const type = cleanText(body.applicationType, 20);
  const applicantName = cleanText(body.applicantName, 80);
  const age = Number(body.age);
  const experience = cleanText(body.experience, 40);
  const answerOne = cleanText(body.answerOne, 2000);
  const answerTwo = cleanText(body.answerTwo, 2000);
  const availability = cleanText(body.availability, 1500);
  if (!TYPES.has(type)) return res.status(400).json({ error: "Choose a valid application type." });
  if (applicantName.length < 2 || !Number.isInteger(age) || age < 16 || age > 99 ||
      !["New to roleplay","Some experience","Experienced"].includes(experience) ||
      answerOne.length < 10 || answerTwo.length < 10) {
    return res.status(400).json({ error: "Please complete all required fields with meaningful answers." });
  }
  const recent = await query("SELECT COUNT(*)::int AS count FROM applications WHERE discord_id=$1 AND submitted_at > NOW() - INTERVAL '24 hours'", [req.session.user.id]);
  if (recent.rows[0].count >= 5) return res.status(429).json({ error: "Application limit reached. Please contact staff if you need help." });
  const result = await query(`INSERT INTO applications(discord_id,application_type,applicant_name,age,experience,answer_one,answer_two,availability)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id,discord_id,application_type,applicant_name,age,experience,answer_one,answer_two,availability,status,submitted_at`,
    [req.session.user.id,type,applicantName,age,experience,answerOne,answerTwo,availability]);
  const application = result.rows[0];
  await audit(req.session.user.id, "application_submitted", "application", application.id, { applicationType: type });
  try {
    await sendApplicationNotification(application);
  } catch (error) {
    // Submission is still valid; log notification failures for deployment troubleshooting.
    console.error("Application saved but Discord notification failed:", error.message, "application", application.id);
  }
  res.status(201).json({ application, message: "Application submitted. Staff will review it." });
});

app.get("/api/staff/applications", requireLogin, requireStaff, async (req, res) => {
  const status = cleanText(req.query.status, 30);
  const type = cleanText(req.query.type, 20);
  const search = cleanText(req.query.search, 80);
  const params = [];
  const clauses = [];
  if (status && STATUSES.has(status)) { params.push(status); clauses.push(`a.status=$${params.length}`); }
  if (type && TYPES.has(type)) { params.push(type); clauses.push(`a.application_type=$${params.length}`); }
  if (search) {
    params.push(`%${search.replace(/[%_]/g, "\\$&")}%`);
    clauses.push(`(a.applicant_name ILIKE $${params.length} OR u.username ILIKE $${params.length} OR a.discord_id=$${params.length})`);
  }
  params.push(200);
  const result = await query(`SELECT a.id,a.discord_id,u.username AS discord_username,a.application_type,a.applicant_name,a.age,a.experience,a.answer_one,a.answer_two,a.availability,a.status,a.reviewer_discord_id,a.reviewer_notes,a.submitted_at,a.updated_at
    FROM applications a JOIN users u ON u.discord_id=a.discord_id
    ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""}
    ORDER BY a.submitted_at DESC LIMIT $${params.length}`, params);
  res.json({ applications: result.rows });
});
app.patch("/api/staff/applications/:id", requireLogin, requireStaff, checkCsrf, async (req, res) => {
  const id = Number(req.params.id);
  const status = cleanText(req.body?.status, 30);
  const reviewerNotes = cleanText(req.body?.reviewerNotes, 3000);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid application ID." });
  if (!STATUSES.has(status)) return res.status(400).json({ error: "Invalid application status." });
  const result = await query(`UPDATE applications SET status=$1,reviewer_discord_id=$2,reviewer_notes=$3,updated_at=NOW()
    WHERE id=$4 RETURNING id,status,reviewer_notes,updated_at`, [status,req.session.user.id,reviewerNotes,id]);
  if (!result.rowCount) return res.status(404).json({ error: "Application not found." });
  await audit(req.session.user.id, "application_updated", "application", id, { status });
  res.json({ application: result.rows[0] });
});
app.get("/api/staff/rules", requireLogin, requireRulesAdmin, async (_req, res) => {
  const result = await query("SELECT rule_key,rules,updated_by,updated_at FROM site_rules ORDER BY rule_key");
  res.json({ rules: result.rows });
});
app.put("/api/staff/rules/:key", requireLogin, requireRulesAdmin, checkCsrf, async (req, res) => {
  const key = cleanText(req.params.key, 20);
  const rules = req.body?.rules;
  if (!["discord","city"].includes(key)) return res.status(400).json({ error: "Unknown rules category." });
  if (!Array.isArray(rules) || rules.length < 1 || rules.length > 40 ||
      rules.some((r) => typeof r !== "string" || r.trim().length < 3 || r.length > 500)) {
    return res.status(400).json({ error: "Provide 1–40 valid rules (3–500 characters each)." });
  }
  const normalized = rules.map((r) => r.trim());
  await query(`INSERT INTO site_rules(rule_key,rules,updated_by,updated_at) VALUES($1,$2::jsonb,$3,NOW())
    ON CONFLICT(rule_key) DO UPDATE SET rules=EXCLUDED.rules,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
    [key,JSON.stringify(normalized),req.session.user.id]);
  await audit(req.session.user.id, "rules_updated", "rules", key, { count: normalized.length });
  res.json({ key, rules: normalized });
});
app.get("/api/staff/audit", requireLogin, requireStaff, async (_req, res) => {
  const result = await query("SELECT id,actor_discord_id,action,target_type,target_id,details,created_at FROM audit_log ORDER BY created_at DESC LIMIT 100");
  res.json({ events: result.rows });
});
app.get("/healthz", async (_req, res) => {
  try { await query("SELECT 1"); res.json({ ok: true, database: "connected" }); }
  catch { res.status(503).json({ ok: false, database: "unavailable" }); }
});
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

const server = app.listen(PORT, () => console.log(`Greenlane RP portal listening on port ${PORT}`));
async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
