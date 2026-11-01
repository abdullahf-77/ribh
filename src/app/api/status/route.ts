import { NextResponse } from "next/server";
import { readConfig } from "@/llm/provider";

export const dynamic = "force-dynamic";

// Tells the UI which mode it is in. Never returns the key.
export function GET() {
  const cfg = readConfig();
  return NextResponse.json({ mode: cfg ? "live" : "demo", model: cfg?.model ?? null });
}
