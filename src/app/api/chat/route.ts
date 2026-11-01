import { runTurn } from "@/chat/turn";
import { TurnRequest, TurnRequestSchema } from "@/chat/types";
import { readConfig } from "@/llm/provider";
import { handle } from "../_lib";

export const maxDuration = 120;

// One conversational turn. The conversation state travels with the request; nothing is stored on the server.
export const POST = handle(TurnRequestSchema, (input) => runTurn(input as unknown as TurnRequest, readConfig()));
