import { describe, expect, it } from "vitest";
import { taskCreateSchema, taskPatchRequest, settingsSchema, signupSchema } from "@/lib/validation";
import { proposedActionSchema } from "@/lib/ai/actions";
import { costUsd, estimateTokens, parseJsonReply, parseResponses } from "@/lib/ai/client";

describe("task validation", () => {
  it("accepts a full task and applies defaults", () => {
    const t = taskCreateSchema.parse({ title: "  Gym  ", date: "2026-10-28", startTime: "18:00", endTime: "19:00", recurrence: { freq: "WEEKLY", byWeekday: [0, 2] } });
    expect(t.title).toBe("Gym");
    expect(t.priority).toBe("MEDIUM");
    expect(t.recurrence?.interval).toBe(1);
  });
  it("rejects end before start, impossible dates and unknown fields", () => {
    expect(taskCreateSchema.safeParse({ title: "x", date: "2026-10-28", startTime: "10:00", endTime: "09:00" }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: "x", date: "2026-02-30" }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: "x", userId: "someone-else" }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: "" }).success).toBe(false);
  });
  it("requires a start date for recurring tasks", () => {
    expect(taskCreateSchema.safeParse({ title: "x", recurrence: { freq: "DAILY", interval: 1 }, date: null }).success).toBe(false);
  });
  it("defaults patch scope to a single occurrence", () => {
    expect(taskPatchRequest.parse({ changes: { completed: true } }).scope).toBe("occurrence");
  });
  it("validates settings and signup", () => {
    expect(settingsSchema.safeParse({ aiModel: "gpt-5-mini" }).success).toBe(true);
    expect(settingsSchema.safeParse({ aiModel: "bad model; rm -rf" }).success).toBe(false);
    expect(settingsSchema.safeParse({ openaiApiKey: "sk-..." }).success).toBe(false); // keys can never be stored via settings
    expect(signupSchema.parse({ name: "K", email: "K@Example.com", password: "12345678" }).email).toBe("k@example.com");
    expect(signupSchema.safeParse({ name: "K", email: "k@example.com", password: "short" }).success).toBe(false);
  });
});

describe("AI proposed actions", () => {
  it("only allows the supported action types", () => {
    expect(proposedActionSchema.safeParse({ type: "create_task", title: "Study", date: "2026-10-29", start_time: "15:00" }).success).toBe(true);
    expect(proposedActionSchema.safeParse({ type: "update_task", task_id: "abc@2026-10-29", date: "2026-10-30" }).success).toBe(true);
    expect(proposedActionSchema.safeParse({ type: "delete_all_tasks" }).success).toBe(false);
    expect(proposedActionSchema.safeParse({ type: "update_task", task_id: "abc", start_time: "25:00" }).success).toBe(false);
  });
});

describe("AI client helpers", () => {
  it("parses JSON replies, including fenced ones", () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonReply('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseJsonReply("Sure! {\"a\":3} hope that helps")).toEqual({ a: 3 });
    expect(parseJsonReply("no json here")).toBeNull();
  });
  it("estimates cost from token counts and per-million prices", () => {
    const p = { inputPricePerMTok: 0.25, cachedInputPricePerMTok: 0.025, outputPricePerMTok: 2 };
    expect(costUsd(p, 1_000_000, 500_000)).toBeCloseTo(1.25);
    // Cached input is billed at the cached rate: 0.5M fresh * 0.25 + 0.5M cached * 0.025
    expect(costUsd(p, 1_000_000, 0, 500_000)).toBeCloseTo(0.1375);
    expect(estimateTokens("", [{ role: "user", content: "x".repeat(400) }])).toBe(104);
  });
  it("parses Responses API output: text, tool calls, reasoning replay and usage", () => {
    const r = parseResponses({
      status: "completed",
      output: [
        { type: "reasoning", id: "rs_1", encrypted_content: "xyz" },
        { type: "function_call", call_id: "call_1", name: "get_tasks", arguments: '{"filter":"overdue"}' },
      ],
      usage: { input_tokens: 1200, output_tokens: 80, input_tokens_details: { cached_tokens: 1024 } },
    });
    expect(r.toolCalls).toEqual([{ id: "call_1", name: "get_tasks", arguments: '{"filter":"overdue"}' }]);
    expect(r.raw).toHaveLength(2); // reasoning item is replayed with the call
    expect(r.cached).toBe(1024);
    const t = parseResponses({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Hello" }] }], usage: { input_tokens: 10, output_tokens: 2 } });
    expect(t.text).toBe("Hello");
    expect(t.toolCalls).toHaveLength(0);
    const cut = parseResponses({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "reasoning" }] });
    expect(cut.truncated).toBe(true);
    expect(cut.text).toBeNull();
  });
});
