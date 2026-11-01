/* Checks a deployed URL: reachable, live mode, no secret in pages, client assets or API responses. Prints no secret. */
const base = process.argv[2];
if (!base) { console.error("usage: node eval/check-production.mjs https://your-app.vercel.app"); process.exit(2); }
const SECRET = /sk-or-v1-[A-Za-z0-9]{10,}|LLAMA_API_KEY|VERCEL_OIDC_TOKEN|Bearer\s+\S+/;
let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) bad++; };

const home = await fetch(base);
const html = await home.text();
check(home.status === 200, `home ${home.status}`);
check(html.includes("مساعد مشتريات"), "serves the current app");
check(!SECRET.test(html), "no secret in the page");

const assets = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\s\\]+\.(?:js|css)/g)].map((m) => m[0]))];
let hits = 0;
for (const a of assets) if (SECRET.test(await (await fetch(base + a)).text())) { hits++; console.log("  secret pattern in", a); }
check(hits === 0, `no secret in ${assets.length} client assets`);
for (const p of ["/.env", "/.env.local", "/.env.example", "/.git/config", "/.vercel/project.json"]) {
  const r = await fetch(base + p);
  check(r.status === 404, `${p} not served (${r.status})`);
}

const status = await (await fetch(`${base}/api/status`)).json();
check(status.mode === "live" && status.model === "meta-llama/llama-4-maverick", `status ${JSON.stringify(status)}`);
check(!SECRET.test(JSON.stringify(status)), "no secret in status");

const empty = { requirements: { category: null, specs: {}, product: null, quantity: null, sizeOz: null, material: null, wall: null, use: null, lid: null, print: null, city: null, requiredDate: null, budgetSar: null, budgetIncludesDelivery: null, budgetIncludesVat: null, other: [] }, reqEvidence: {}, waived: [], offers: [], confirmedOfferIds: [], rejected: {}, priority: "cash", orderDate: "2026-11-02", analyzedOtherKey: "[]", scenarioQuantity: null };
const t = Date.now();
const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "أبي ٢٠٠٠ كيس ورقي بمقابض، التوصيل إلى الرياض", event: null, history: [], state: empty, today: "2026-11-02" }) });
const raw = await res.text();
check(res.status === 200, `chat turn ${res.status} in ${Date.now() - t}ms`);
check(!SECRET.test(raw), "no secret in chat response");
const out = JSON.parse(raw);
console.log("  reply:", out.reply ?? out.error?.message, "| source:", out.replySource, "| mode:", out.mode);
check(out.mode === "live", "response is from live mode");
check(out.patch?.requirements?.category === "bags" && out.patch?.requirements?.quantity === 2000, "Llama read category and quantity");

const invalid = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: "not json" });
check(invalid.status === 400, `bad input rejected (${invalid.status})`);
const large = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(300000) });
check(large.status === 413, `oversized input rejected (${large.status})`);
console.log(bad ? `\n${bad} FAILED` : "\nPRODUCTION CHECKS OK");
process.exit(bad ? 1 : 0);
