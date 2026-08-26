const BASE = "https://app.wavesco.in";
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (ok) pass++; else fail++;
}

// 1 HTTPS + login page
const home = await fetch(BASE, { redirect: "manual" });
check("HTTPS login page 200", home.status === 200);
const html = await home.text();
check("no localhost leak", !html.includes("localhost:"));
check("no xsmtpsib leak", !html.includes("xsmtpsib"));
check("no Neon host leak", !html.includes("neon.tech"));

// 2 CSRF + login
const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
const setCookies = csrfRes.headers.getSetCookie?.() ?? [];
const cookieJar = setCookies.map((c) => c.split(";")[0]).join("; ");
const login = await fetch(`${BASE}/api/auth/callback/credentials`, {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    cookie: cookieJar,
  },
  body: new URLSearchParams({
    csrfToken,
    email: process.env.SMOKE_EMAIL ?? "",
    password: process.env.SMOKE_PASSWORD ?? "",
    json: "true",
  }),
});
const loginCookies = [
  ...cookieJar.split("; ").filter(Boolean),
  ...(login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]),
].join("; ");
check("credentials login accepted", login.status === 200 || login.status === 302);

// 3 Authenticated route smoke
const authedRoutes = [
  "/command", "/overview", "/acquisition", "/acquisition/leads",
  "/acquisition/pipeline", "/acquisition/campaigns", "/acquisition/outreach",
  "/acquisition/follow-ups", "/acquisition/reports", "/clients",
  "/intelligence/ai", "/intelligence/analytics", "/knowledge", "/billing", "/settings",
];
for (const route of authedRoutes) {
  const r = await fetch(BASE + route, { headers: { cookie: loginCookies }, redirect: "manual" });
  check(`authed ${route} -> ${r.status}`, r.status === 200);
}

// 4 AI entitlement state on enabled workspace
{
  const r = await fetch(`${BASE}/intelligence/ai`, { headers: { cookie: loginCookies } });
  const t = await r.text();
  check("AI page 200 (enabled workspace)", r.status === 200);
  check("no provider name leak (ollama)", !t.toLowerCase().includes("ollama"));
  check("no provider key leak", !t.includes(process.env.OPENAI_API_KEY?.slice(0, 12) ?? "___"));
}

// 5 Gateway endpoint present + token-guarded
{
  const r = await fetch(`${BASE}/api/ai/gateway`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "summarize", prompt: "x" }),
  });
  check(`gateway no-token denied (${r.status})`, r.status === 401 || r.status === 503);
}

// 6 Unauth still rejected
{
  const r = await fetch(`${BASE}/command`, { redirect: "manual" });
  check(`unauth /command still redirected (${r.status})`, r.status >= 300 && r.status < 400);
}

console.log(`\nPROD SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
