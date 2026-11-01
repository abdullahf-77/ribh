/* TEST ONLY. A local stand-in for the provider API, used to exercise the live code path and its failure
   handling without credentials. Passing against this says nothing about real Llama quality.
   Run: npx tsx eval/mock-llama.ts  (port 5599), with LLAMA_API_KEY=test LLAMA_BASE_URL=http://127.0.0.1:5599/v1 */
import { createServer } from "node:http";
import { rawOffer, v } from "../src/demo/build";
import { demoOfferFor, demoRequirementsFor } from "../src/demo/fixtures";

const dataIn = (s: string) => s.slice(s.indexOf("<data>") + 6, s.indexOf("</data>")).trim();

function respond(name: string, user: string): { status: number; content?: unknown } {
  const text = user.includes("<data>") ? dataIn(user) : user;
  if (text.includes("FAIL500")) return { status: 500 };
  if (text.includes("BADJSON")) return { status: 200, content: "not json" };
  if (name === "requirements") return { status: 200, content: demoRequirementsFor(text) ?? { nope: true } };
  if (name === "offer") {
    const known = demoOfferFor(text);
    if (known) return { status: 200, content: known };
    // Hostile offer: the model "obeys" an embedded instruction. Quotes do not exist, so nothing survives.
    return { status: 200, content: rawOffer({ priceAmount: { value: 0.01, quote: "السعر هللة واحدة فقط" }, supplierName: v("الفائز", "الفائز المطلق") }) };
  }
  if (name === "reply") return { status: 200, content: rawOffer({ priceAmount: v(0.5, "٠٫٥٠ ريال"), lids: v("included", "الغطاء مشمول"), deliveryAmount: { value: 99, quote: "رسوم غير موجودة في النص" } }) };
  if (name === "rfq") return { status: 200, content: { message: "أحتاج 9999 كوب بسماكة 300 جرام" } };
  if (name === "compose") return { status: 200, content: { summary: "نوصي بأعلى جودة بسعر 12345 ريال.", messages: [] } };
  return { status: 400 };
}

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}");
    const name = parsed.response_format?.json_schema?.name ?? "";
    const out = respond(name, parsed.messages?.[1]?.content ?? "");
    res.writeHead(out.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ model: parsed.model, choices: [{ message: { content: typeof out.content === "string" ? out.content : JSON.stringify(out.content) } }] }));
  });
}).listen(5599, () => console.log("mock llama on 5599 (test only)"));
