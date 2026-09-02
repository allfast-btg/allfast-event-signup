const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const EVENT_SLUG = process.env.EVENT_SLUG || "tailgate-thursday-2026-09-03";
const EVENT_NAME = process.env.EVENT_NAME || "Tailgate Thursday";
const EVENT_DATE = process.env.EVENT_DATE || "September 3, 2026";
const FACEBOOK_URL = process.env.FACEBOOK_URL || "https://www.facebook.com/ALLFASTSupply/";
const INSTAGRAM_URL = process.env.INSTAGRAM_URL || "https://www.instagram.com/allfastsupply";
const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL || "https://g.page/r/CZ8MDzS2WY6AEAE/review";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const PUBLIC_URL = process.env.PUBLIC_URL || "";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Use a PostgreSQL database (Render Postgres works well).");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id SERIAL PRIMARY KEY,
      event_slug TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      company TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      email_consent BOOLEAN NOT NULL DEFAULT TRUE,
      facebook_follow BOOLEAN NOT NULL DEFAULT FALSE,
      instagram_follow BOOLEAN NOT NULL DEFAULT FALSE,
      entries_count INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(event_slug, email)
    );
  `);
}
initDb().catch(err => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function htmlEscape(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/config", (req, res) => {
  res.json({
    eventSlug: EVENT_SLUG,
    eventName: EVENT_NAME,
    eventDate: EVENT_DATE,
    facebookUrl: FACEBOOK_URL,
    instagramUrl: INSTAGRAM_URL,
    googleReviewUrl: GOOGLE_REVIEW_URL,
    publicUrl: PUBLIC_URL
  });
});

app.post("/api/enter", async (req, res) => {
  try {
    const firstName = String(req.body.firstName || "").trim();
    const lastName = String(req.body.lastName || "").trim();
    const company = String(req.body.company || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = String(req.body.phone || "").trim();
    const facebookFollow = req.body.facebookFollow === true || req.body.facebookFollow === "true";
    const instagramFollow = req.body.instagramFollow === true || req.body.instagramFollow === "true";
    const emailConsent = req.body.emailConsent !== false && req.body.emailConsent !== "false";

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ ok: false, error: "First name, last name, and email are required." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: "Please enter a valid email address." });
    }

    const entriesCount = 1 + (facebookFollow ? 1 : 0) + (instagramFollow ? 1 : 0);

    const q = `
      INSERT INTO entries (
        event_slug, first_name, last_name, company, email, phone,
        email_consent, facebook_follow, instagram_follow, entries_count
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (event_slug, email)
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        company = EXCLUDED.company,
        phone = EXCLUDED.phone,
        email_consent = EXCLUDED.email_consent,
        facebook_follow = EXCLUDED.facebook_follow,
        instagram_follow = EXCLUDED.instagram_follow,
        entries_count = EXCLUDED.entries_count
      RETURNING id, entries_count, created_at
    `;
    const result = await pool.query(q, [
      EVENT_SLUG, firstName, lastName, company, email, phone,
      emailConsent, facebookFollow, instagramFollow, entriesCount
    ]);

    return res.json({
      ok: true,
      entriesCount: result.rows[0].entries_count,
      googleReviewUrl: GOOGLE_REVIEW_URL
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "We could not save your entry. Please try again." });
  }
});

function adminAuthorized(req) {
  if (!ADMIN_PASSWORD) return false;
  const supplied = req.query.key || req.headers["x-admin-password"] || "";
  return supplied === ADMIN_PASSWORD;
}

app.get("/admin", async (req, res) => {
  if (!adminAuthorized(req)) return res.status(401).send("Unauthorized");
  const result = await pool.query(
    `SELECT * FROM entries WHERE event_slug=$1 ORDER BY created_at DESC`,
    [EVENT_SLUG]
  );

  const rows = result.rows.map(r => `
    <tr>
      <td>${r.id}</td>
      <td>${htmlEscape(r.first_name)} ${htmlEscape(r.last_name)}</td>
      <td>${htmlEscape(r.company)}</td>
      <td>${htmlEscape(r.email)}</td>
      <td>${htmlEscape(r.phone)}</td>
      <td>${r.facebook_follow ? "Yes" : ""}</td>
      <td>${r.instagram_follow ? "Yes" : ""}</td>
      <td>${r.entries_count}</td>
      <td>${new Date(r.created_at).toLocaleString()}</td>
    </tr>
  `).join("");

  res.send(`<!doctype html>
  <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ALLFAST Entries</title>
  <style>
    body{font-family:Arial,sans-serif;margin:24px;color:#161616}
    table{border-collapse:collapse;width:100%;font-size:14px}
    th,td{border:1px solid #ddd;padding:8px;text-align:left}
    th{background:#f4f4f4}
    .top{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
    a{color:#111}
  </style></head>
  <body>
    <div class="top">
      <h1>${htmlEscape(EVENT_NAME)} Entries</h1>
      <a href="/admin/export.csv?key=${encodeURIComponent(ADMIN_PASSWORD)}">Download CSV</a>
    </div>
    <p>${result.rowCount} signup(s)</p>
    <table>
      <thead><tr><th>ID</th><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Facebook</th><th>Instagram</th><th>Entries</th><th>Submitted</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body></html>`);
});

app.get("/admin/export.csv", async (req, res) => {
  if (!adminAuthorized(req)) return res.status(401).send("Unauthorized");
  const result = await pool.query(
    `SELECT first_name,last_name,company,email,phone,email_consent,facebook_follow,instagram_follow,entries_count,created_at
     FROM entries WHERE event_slug=$1 ORDER BY created_at ASC`,
    [EVENT_SLUG]
  );

  const headers = ["First Name","Last Name","Company","Email","Phone","Email Consent","Facebook Follow","Instagram Follow","Entries","Created At"];
  const esc = v => `"${String(v ?? "").replaceAll('"','""')}"`;
  const csv = [headers.map(esc).join(",")].concat(
    result.rows.map(r => [
      r.first_name,r.last_name,r.company,r.email,r.phone,
      r.email_consent,r.facebook_follow,r.instagram_follow,r.entries_count,r.created_at.toISOString()
    ].map(esc).join(","))
  ).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${EVENT_SLUG}-entries.csv"`);
  res.send(csv);
});

app.get("/admin/draw", async (req, res) => {
  if (!adminAuthorized(req)) return res.status(401).send("Unauthorized");
  const result = await pool.query(
    `SELECT id,first_name,last_name,company,email,entries_count
     FROM entries WHERE event_slug=$1`,
    [EVENT_SLUG]
  );
  const weighted = [];
  for (const r of result.rows) {
    for (let i=0; i<r.entries_count; i++) weighted.push(r);
  }
  if (!weighted.length) return res.json({ ok:false, error:"No entries yet." });
  const winner = weighted[Math.floor(Math.random() * weighted.length)];
  res.json({ ok:true, winner });
});

app.listen(PORT, () => {
  console.log(`ALLFAST event signup running on port ${PORT}`);
});
