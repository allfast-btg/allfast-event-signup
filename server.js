const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const EVENT_SLUG = process.env.EVENT_SLUG || "tailgate-thursday-2026-09-03";
const EVENT_NAME = process.env.EVENT_NAME || "Tailgate Thursday";
const EVENT_DATE = process.env.EVENT_DATE || "September 3, 2026";
const FACEBOOK_URL = process.env.FACEBOOK_URL || "https://www.facebook.com/ALLFASTSupply/";
const LINKEDIN_URL = process.env.LINKEDIN_URL || "https://www.linkedin.com/company/allfast-supply";
const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL || "https://g.page/r/CZ8MDzS2WY6AEAE/review";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const PUBLIC_URL = process.env.PUBLIC_URL || "https://allfast-event-signup.onrender.com";

const CC_CLIENT_ID = process.env.CONSTANT_CONTACT_CLIENT_ID || "";
const CC_CLIENT_SECRET = process.env.CONSTANT_CONTACT_CLIENT_SECRET || "";
const CC_REDIRECT_URI = process.env.CONSTANT_CONTACT_REDIRECT_URI || `${PUBLIC_URL.replace(/\/$/, "")}/auth/constant-contact/callback`;
const CC_LIST_NAME = process.env.CONSTANT_CONTACT_LIST_NAME || "ALLFAST Event Signups";
const CC_AUTH_URL = "https://authz.constantcontact.com/oauth2/default/v1/authorize";
const CC_TOKEN_URL = "https://authz.constantcontact.com/oauth2/default/v1/token";
const CC_API_BASE = "https://api.cc.email/v3";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

  await pool.query(`
    ALTER TABLE entries
      ADD COLUMN IF NOT EXISTS linkedin_follow BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS constant_contact_status TEXT,
      ADD COLUMN IF NOT EXISTS constant_contact_synced_at TIMESTAMPTZ;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS integrations (
      integration_name TEXT PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at TIMESTAMPTZ,
      oauth_state TEXT,
      list_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO integrations (integration_name)
    VALUES ('constant_contact')
    ON CONFLICT (integration_name) DO NOTHING;
  `);
}
initDb().catch(err => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});

function htmlEscape(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(
    raw.split(";").map(v => v.trim()).filter(Boolean).map(v => {
      const i = v.indexOf("=");
      return i === -1 ? [v, ""] : [v.slice(0, i), decodeURIComponent(v.slice(i + 1))];
    })
  );
}
function adminCookieToken() {
  if (!ADMIN_PASSWORD) return "";
  return crypto.createHmac("sha256", ADMIN_PASSWORD)
    .update("allfast-admin-session")
    .digest("hex");
}
function adminAuthorized(req) {
  if (!ADMIN_PASSWORD) return false;
  const supplied = req.query.key || req.headers["x-admin-password"] || "";
  if (supplied && supplied === ADMIN_PASSWORD) return true;
  const cookies = parseCookies(req);
  return cookies.allfast_admin === adminCookieToken();
}
function adminLoginPage(message = "") {
  return `<!doctype html>
  <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ALLFAST Admin Login</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#171717;display:grid;min-height:100vh;place-items:center;padding:24px}
    .card{width:min(440px,100%);background:#fff;border-radius:16px;padding:30px;box-shadow:0 12px 35px rgba(0,0,0,.12)}
    h1{margin:0 0 8px;color:#123f95} p{line-height:1.45}
    label{font-weight:700;display:block;margin:22px 0 8px}
    input{width:100%;padding:13px;border:1px solid #bbb;border-radius:8px;font-size:16px}
    button{width:100%;margin-top:16px;padding:14px;border:0;border-radius:8px;background:#123f95;color:white;font-size:16px;font-weight:800;cursor:pointer}
    .error{background:#fff1ee;color:#9c2a13;padding:10px 12px;border-radius:8px}
    .note{font-size:13px;color:#666}
  </style></head>
  <body><div class="card">
    <h1>ALLFAST Admin</h1>
    <p>Enter the admin password to view event entries.</p>
    ${message ? `<p class="error">${htmlEscape(message)}</p>` : ""}
    <form method="post" action="/admin/login">
      <label for="password">Admin Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">SIGN IN</button>
    </form>
    <p class="note">If this page reports that the password is not configured, check the Render Environment setting named ADMIN_PASSWORD.</p>
  </div></body></html>`;
}
function basicAuthHeader() {
  return "Basic " + Buffer.from(`${CC_CLIENT_ID}:${CC_CLIENT_SECRET}`).toString("base64");
}
async function getIntegration() {
  const r = await pool.query(`SELECT * FROM integrations WHERE integration_name='constant_contact' LIMIT 1`);
  return r.rows[0] || null;
}
async function saveTokens(data) {
  const expiresAt = new Date(Date.now() + Math.max(60, Number(data.expires_in || 7200)-120)*1000);
  await pool.query(`
    UPDATE integrations SET access_token=$1, refresh_token=COALESCE($2,refresh_token),
    token_expires_at=$3, updated_at=NOW() WHERE integration_name='constant_contact'`,
    [data.access_token, data.refresh_token || null, expiresAt]);
}
async function exchangeCode(code) {
  const body = new URLSearchParams({code, redirect_uri:CC_REDIRECT_URI, grant_type:"authorization_code"});
  const r = await fetch(CC_TOKEN_URL,{method:"POST",headers:{
    "Accept":"application/json","Content-Type":"application/x-www-form-urlencoded","Authorization":basicAuthHeader()
  },body});
  const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`CC token exchange ${r.status}: ${JSON.stringify(data)}`);
  await saveTokens(data);
  return data.access_token;
}
async function refreshToken(refresh_token) {
  const body = new URLSearchParams({refresh_token,grant_type:"refresh_token"});
  const r = await fetch(CC_TOKEN_URL,{method:"POST",headers:{
    "Accept":"application/json","Content-Type":"application/x-www-form-urlencoded","Authorization":basicAuthHeader()
  },body});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`CC refresh ${r.status}: ${JSON.stringify(data)}`);
  await saveTokens(data);
  return data.access_token;
}
async function validToken() {
  const i=await getIntegration();
  if(!i?.access_token) throw new Error("Constant Contact is not connected.");
  if(i.token_expires_at && new Date(i.token_expires_at).getTime()>Date.now()+60000) return i.access_token;
  if(!i.refresh_token) throw new Error("Constant Contact refresh token missing.");
  return refreshToken(i.refresh_token);
}
async function ccApi(endpoint, options={}) {
  let token=await validToken();
  const call=(t)=>fetch(`${CC_API_BASE}${endpoint}`,{...options,headers:{
    "Accept":"application/json",...(options.body?{"Content-Type":"application/json"}:{}),
    ...(options.headers||{}),"Authorization":`Bearer ${t}`
  }});
  let r=await call(token);
  if(r.status===401){
    const i=await getIntegration();
    if(i?.refresh_token){ token=await refreshToken(i.refresh_token); r=await call(token); }
  }
  return r;
}
async function ensureList() {
  const i=await getIntegration();
  if(i?.list_id) return i.list_id;
  let r=await ccApi("/contact_lists?limit=500");
  let data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`CC list read ${r.status}: ${JSON.stringify(data)}`);
  let list=(data.lists||[]).find(x=>(x.name||"").trim().toLowerCase()===CC_LIST_NAME.toLowerCase());
  if(!list){
    r=await ccApi("/contact_lists",{method:"POST",body:JSON.stringify({
      name:CC_LIST_NAME,favorite:true,description:"Contacts who opted in through ALLFAST event signup forms."
    })});
    list=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(`CC list create ${r.status}: ${JSON.stringify(list)}`);
  }
  await pool.query(`UPDATE integrations SET list_id=$1,updated_at=NOW() WHERE integration_name='constant_contact'`,[list.list_id]);
  return list.list_id;
}
async function syncCC(c) {
  if(!c.emailConsent) return;
  const listId=await ensureList();
  const payload={email_address:c.email,first_name:c.firstName,last_name:c.lastName,list_memberships:[listId]};
  if(c.company) payload.company_name=c.company;
  if(c.phone) payload.phone_number=c.phone;
  const r=await ccApi("/contacts/sign_up_form",{method:"POST",body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`CC contact sync ${r.status}: ${JSON.stringify(data)}`);
}

app.get("/health",(req,res)=>res.json({ok:true}));
app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.get("/config",(req,res)=>res.json({
  eventName:EVENT_NAME,eventDate:EVENT_DATE,facebookUrl:FACEBOOK_URL,linkedinUrl:LINKEDIN_URL,
  googleReviewUrl:GOOGLE_REVIEW_URL,publicUrl:PUBLIC_URL
}));

app.get("/auth/constant-contact/start", async(req,res)=>{
  if(!adminAuthorized(req)) return res.status(401).send("Unauthorized");
  const state=crypto.randomBytes(24).toString("hex");
  await pool.query(`UPDATE integrations SET oauth_state=$1,updated_at=NOW() WHERE integration_name='constant_contact'`,[state]);
  const p=new URLSearchParams({client_id:CC_CLIENT_ID,redirect_uri:CC_REDIRECT_URI,response_type:"code",
    scope:"contact_data offline_access",state});
  res.redirect(`${CC_AUTH_URL}?${p.toString()}`);
});
app.get("/auth/constant-contact/callback",async(req,res)=>{
  try{
    const i=await getIntegration();
    if(!req.query.code || !req.query.state || req.query.state!==i?.oauth_state) return res.status(400).send("Invalid Constant Contact authorization response.");
    await exchangeCode(String(req.query.code));
    await pool.query(`UPDATE integrations SET oauth_state=NULL,updated_at=NOW() WHERE integration_name='constant_contact'`);
    await ensureList();
    res.send(`<!doctype html><meta name="viewport" content="width=device-width"><style>body{font-family:Arial;max-width:620px;margin:60px auto;padding:20px;text-align:center}div{border:1px solid #ddd;border-radius:16px;padding:30px}</style><div><h1>✓ Constant Contact Connected</h1><p>New consenting ALLFAST event signups will sync automatically to <strong>${htmlEscape(CC_LIST_NAME)}</strong>.</p></div>`);
  }catch(e){console.error(e);res.status(500).send("Constant Contact connection failed. Check Render logs.");}
});
app.get("/admin/constant-contact",async(req,res)=>{
  if(!adminAuthorized(req)) return res.status(401).send("Unauthorized");
  const i=await getIntegration(), connected=Boolean(i?.access_token&&i?.refresh_token);
  res.send(`<!doctype html><meta name="viewport" content="width=device-width"><style>body{font-family:Arial;max-width:650px;margin:50px auto;padding:20px}a{display:inline-block;background:#111;color:white;padding:12px 18px;border-radius:8px;text-decoration:none}</style><h1>Constant Contact</h1><p>Status: <strong>${connected?"Connected":"Not connected"}</strong></p><p>List: ${htmlEscape(CC_LIST_NAME)}</p><a href="/auth/constant-contact/start">${connected?"Reconnect":"Connect"} Constant Contact</a>`);
});

app.post("/api/enter",async(req,res)=>{
  try{
    const firstName=String(req.body.firstName||"").trim(), lastName=String(req.body.lastName||"").trim();
    const company=String(req.body.company||"").trim(), email=String(req.body.email||"").trim().toLowerCase();
    const phone=String(req.body.phone||"").trim();
    const facebookFollow=req.body.facebookFollow===true||req.body.facebookFollow==="true";
    const linkedinFollow=req.body.linkedinFollow===true||req.body.linkedinFollow==="true";
    const emailConsent=req.body.emailConsent!==false&&req.body.emailConsent!=="false";
    if(!firstName||!lastName||!email||!phone) return res.status(400).json({ok:false,error:"First name, last name, email, and phone are required."});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ok:false,error:"Please enter a valid email address."});
    if(!emailConsent) return res.status(400).json({ok:false,error:"Email permission is required to enter through this signup form."});
    const entriesCount=1+(facebookFollow?1:0)+(linkedinFollow?1:0);
    const q=`INSERT INTO entries(event_slug,first_name,last_name,company,email,phone,email_consent,facebook_follow,linkedin_follow,instagram_follow,entries_count,constant_contact_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,$10,'pending')
      ON CONFLICT(event_slug,email) DO UPDATE SET first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,
      company=EXCLUDED.company,phone=EXCLUDED.phone,email_consent=EXCLUDED.email_consent,
      facebook_follow=EXCLUDED.facebook_follow,linkedin_follow=EXCLUDED.linkedin_follow,instagram_follow=FALSE,
      entries_count=EXCLUDED.entries_count,constant_contact_status='pending'
      RETURNING id,entries_count`;
    const r=await pool.query(q,[EVENT_SLUG,firstName,lastName,company,email,phone,emailConsent,facebookFollow,linkedinFollow,entriesCount]);
    let ccStatus="not_connected";
    try{
      const i=await getIntegration();
      if(i?.access_token&&i?.refresh_token){
        await syncCC({firstName,lastName,company,email,phone,emailConsent});
        ccStatus="synced";
        await pool.query(`UPDATE entries SET constant_contact_status='synced',constant_contact_synced_at=NOW() WHERE id=$1`,[r.rows[0].id]);
      }else await pool.query(`UPDATE entries SET constant_contact_status='not_connected' WHERE id=$1`,[r.rows[0].id]);
    }catch(e){ccStatus="error";console.error("Constant Contact sync:",e);await pool.query(`UPDATE entries SET constant_contact_status='error' WHERE id=$1`,[r.rows[0].id]);}
    res.json({ok:true,entriesCount:r.rows[0].entries_count,emailListSync:ccStatus});
  }catch(e){console.error(e);res.status(500).json({ok:false,error:"We could not save your entry. Please try again."});}
});


app.get("/admin/status",(req,res)=>{
  res.json({
    ok:true,
    adminPasswordConfigured:Boolean(ADMIN_PASSWORD),
    adminPasswordLength:ADMIN_PASSWORD.length
  });
});

app.post("/admin/login",(req,res)=>{
  if(!ADMIN_PASSWORD){
    return res.status(503).send(adminLoginPage("ADMIN_PASSWORD is not configured on this Render service."));
  }
  const password=String(req.body.password||"");
  if(password!==ADMIN_PASSWORD){
    return res.status(401).send(adminLoginPage("Incorrect admin password."));
  }
  res.setHeader(
    "Set-Cookie",
    `allfast_admin=${encodeURIComponent(adminCookieToken())}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`
  );
  return res.redirect("/admin");
});

app.get("/admin",async(req,res)=>{
  if(!adminAuthorized(req)){
    if(!ADMIN_PASSWORD) return res.status(503).send(adminLoginPage("ADMIN_PASSWORD is not configured on this Render service."));
    return res.status(401).send(adminLoginPage());
  }
  const r=await pool.query(`SELECT * FROM entries WHERE event_slug=$1 ORDER BY created_at DESC`,[EVENT_SLUG]);
  const rows=r.rows.map(x=>`<tr><td>${x.id}</td><td>${htmlEscape(x.first_name)} ${htmlEscape(x.last_name)}</td><td>${htmlEscape(x.company)}</td><td>${htmlEscape(x.email)}</td><td>${x.facebook_follow?"Yes":""}</td><td>${x.linkedin_follow?"Yes":""}</td><td>${x.entries_count}</td><td>${htmlEscape(x.constant_contact_status||"")}</td></tr>`).join("");
  res.send(`<!doctype html><meta name="viewport" content="width=device-width"><style>body{font-family:Arial;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#eee}a{margin-right:16px}</style><h1>${htmlEscape(EVENT_NAME)} Entries</h1><p><a href="/admin/export.csv">Download CSV</a><a href="/admin/constant-contact">Constant Contact</a><a href="/admin/draw">Draw Winner</a><a href="/admin/clear">Clear Test Entries</a></p><table><tr><th>ID</th><th>Name</th><th>Company</th><th>Email</th><th>Facebook</th><th>LinkedIn</th><th>Entries</th><th>Constant Contact</th></tr>${rows}</table>`);
});
app.get("/admin/export.csv",async(req,res)=>{
  if(!adminAuthorized(req)) return res.status(401).send("Unauthorized");
  const r=await pool.query(`SELECT first_name,last_name,company,email,phone,email_consent,facebook_follow,linkedin_follow,entries_count,constant_contact_status,created_at FROM entries WHERE event_slug=$1 ORDER BY created_at`,[EVENT_SLUG]);
  const esc=v=>`"${String(v??"").replaceAll('"','""')}"`;
  const rows=[["First Name","Last Name","Company","Email","Phone","Email Consent","Facebook Follow","LinkedIn Follow","Entries","Constant Contact","Created At"],...r.rows.map(x=>[x.first_name,x.last_name,x.company,x.email,x.phone,x.email_consent,x.facebook_follow,x.linkedin_follow,x.entries_count,x.constant_contact_status,new Date(x.created_at).toISOString()])];
  res.type("text/csv").set("Content-Disposition",`attachment; filename="${EVENT_SLUG}-entries.csv"`).send(rows.map(row=>row.map(esc).join(",")).join("\n"));
});

app.get("/admin/clear",(req,res)=>{
  if(!adminAuthorized(req)) return res.status(401).send(adminLoginPage());
  res.send(`<!doctype html>
  <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Clear Tailgate Thursday Entries</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#171717;display:grid;min-height:100vh;place-items:center;padding:24px}
    .card{width:min(620px,100%);background:#fff;border-radius:16px;padding:32px;box-shadow:0 12px 35px rgba(0,0,0,.12)}
    h1{margin:0 0 12px;color:#123f95}
    .warning{background:#fff1ee;border-left:5px solid #f15a00;padding:14px 16px;margin:20px 0;line-height:1.5}
    input{width:100%;padding:13px;border:1px solid #bbb;border-radius:8px;font-size:16px;margin-top:8px}
    button{width:100%;margin-top:16px;padding:14px;border:0;border-radius:8px;background:#b42318;color:#fff;font-size:16px;font-weight:800;cursor:pointer}
    a{display:inline-block;margin-top:18px;color:#123f95}
    code{background:#f2f2f2;padding:2px 5px;border-radius:4px}
  </style></head>
  <body><div class="card">
    <h1>Clear Tailgate Thursday Entries</h1>
    <div class="warning"><strong>Warning:</strong> This permanently deletes every entry currently stored for this event from the ALLFAST signup database. It does not delete contacts from Constant Contact.</div>
    <p>Use this now to remove today's test records before the live event.</p>
    <form method="post" action="/admin/clear">
      <label for="confirm"><strong>Type DELETE ALL ENTRIES to confirm:</strong></label>
      <input id="confirm" name="confirm" autocomplete="off" required>
      <button type="submit">DELETE ALL ENTRIES</button>
    </form>
    <a href="/admin">Cancel and return to entries</a>
  </div></body></html>`);
});

app.post("/admin/clear",async(req,res)=>{
  if(!adminAuthorized(req)) return res.status(401).send(adminLoginPage());
  const confirm=String(req.body.confirm||"").trim();
  if(confirm!=="DELETE ALL ENTRIES"){
    return res.status(400).send(`<!doctype html><html><body style="font-family:Arial;padding:40px">
      <h1>Entries were not deleted.</h1>
      <p>The confirmation text did not match.</p>
      <p><a href="/admin/clear">Try again</a> &nbsp; <a href="/admin">Back to entries</a></p>
    </body></html>`);
  }
  try{
    const result=await pool.query("DELETE FROM entries WHERE event_slug=$1",[EVENT_SLUG]);
    return res.send(`<!doctype html><html><body style="font-family:Arial;padding:40px">
      <h1>Entries Cleared</h1>
      <p><strong>${result.rowCount}</strong> entr${result.rowCount===1?"y":"ies"} deleted from the Tailgate Thursday drawing database.</p>
      <p>Constant Contact contacts were not changed.</p>
      <p><a href="/admin">Return to entries</a></p>
    </body></html>`);
  }catch(err){
    console.error("Clear entries failed:",err);
    return res.status(500).send(`<!doctype html><html><body style="font-family:Arial;padding:40px">
      <h1>Could not clear entries</h1>
      <p>No confirmation of deletion was returned. Please check the Render logs before trying again.</p>
      <p><a href="/admin">Back to entries</a></p>
    </body></html>`);
  }
});

app.get("/admin/draw",async(req,res)=>{
  if(!adminAuthorized(req)) return res.status(401).send("Unauthorized");
  const r=await pool.query(`SELECT id,first_name,last_name,company,email,entries_count FROM entries WHERE event_slug=$1`,[EVENT_SLUG]);
  const weighted=[]; for(const x of r.rows) for(let i=0;i<x.entries_count;i++) weighted.push(x);
  if(!weighted.length) return res.json({ok:false,error:"No entries yet."});
  res.json({ok:true,winner:weighted[Math.floor(Math.random()*weighted.length)]});
});

app.listen(PORT,()=>console.log(`ALLFAST event signup running on port ${PORT}`));
