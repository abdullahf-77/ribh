/* Measures extraction on the held-out set against the configured live model. Prints measured numbers only
   and writes them to eval/results.json. Refuses to run without credentials rather than reporting fixtures. */
import { writeFileSync } from "node:fs";
import { LlmError, readConfig } from "../src/llm/provider";
import { extractOffer } from "../src/llm/service";
import { heldOut } from "./heldout";
import { Score, scoreExample } from "./score";

async function main() {
  const cfg = readConfig();
  if (!cfg) {
    console.error("NOT RUN: LLAMA_API_KEY is not set. No evaluation results exist for this configuration.");
    process.exit(2);
  }
  const rows: ({ id: string; failed?: string } & Partial<Score> & { rejectedQuotes?: number })[] = [];
  for (const ex of heldOut) {
    try {
      const { validated } = await extractOffer("A", ex.text, [], cfg);
      const score = scoreExample(validated, ex.expect);
      rows.push({ id: ex.id, ...score, rejectedQuotes: validated.rejected.length });
      console.log(`${ex.id}: ${score.correct}/${score.total}`, score.mistakes.length ? JSON.stringify(score.mistakes) : "");
    } catch (e) {
      const code = e instanceof LlmError ? e.code : "error";
      rows.push({ id: ex.id, failed: code });
      console.log(`${ex.id}: FAILED (${code})`);
    }
  }
  const ok = rows.filter((r) => !r.failed);
  const sum = (k: "correct" | "total" | "invented" | "missed" | "wrong" | "rejectedQuotes") => ok.reduce((a, r) => a + (r[k] ?? 0), 0);
  const summary = {
    model: cfg.model, baseUrl: cfg.baseUrl, date: new Date().toISOString(),
    examples: rows.length, failedRequests: rows.length - ok.length,
    fieldsCorrect: sum("correct"), fieldsScored: sum("total"),
    invented: sum("invented"), missed: sum("missed"), wrong: sum("wrong"), rejectedQuotes: sum("rejectedQuotes"),
  };
  console.log(summary);
  writeFileSync("eval/results.json", JSON.stringify({ summary, rows }, null, 2));
}

main();
