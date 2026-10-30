import { describe, expect, it } from "vitest";
import { quickAnswer } from "@/lib/ai/quick-answers";
import type { ScheduleItem } from "@/lib/types";

const item = (p: Partial<ScheduleItem>): ScheduleItem =>
  ({ id: p.title, taskId: p.title, title: "x", kind: "TASK", date: "2026-11-02", startTime: null, endTime: null, completed: false, location: null, ...p }) as ScheduleItem;

const items = [
  item({ title: "Maths", kind: "CLASS", date: "2026-11-02", startTime: "09:00", endTime: "10:30", location: "HS 1" }),
  item({ title: "Physics", kind: "CLASS", date: "2026-11-02", startTime: "14:00", endTime: "15:30" }),
  item({ title: "Team sync", kind: "MEETING", date: "2026-11-03", startTime: "13:00", endTime: "14:00" }),
];

describe("quick answers (no AI)", () => {
  it("answers 'next class' from real data, skipping classes that already started", () => {
    expect(quickAnswer("What is my next class?", items, "2026-11-02", 10 * 60)).toBe("Your next class is **Physics** today at 2 PM–3:30 PM.");
    expect(quickAnswer("when's my next class", items, "2026-11-02", 8 * 60)).toContain("Maths");
  });
  it("lists meetings for tomorrow and says so when there are none", () => {
    expect(quickAnswer("What meetings do I have tomorrow?", items, "2026-11-02", 0)).toContain("Team sync");
    expect(quickAnswer("What meetings do I have today?", items, "2026-11-02", 0)).toBe("You have no meetings today.");
  });
  it("never invents: no class → says it doesn't see one", () => {
    expect(quickAnswer("What is my next exam?", items, "2026-11-02", 0)).toMatch(/don't see another exam/);
  });
  it("leaves anything needing judgement or action to the AI", () => {
    expect(quickAnswer("Move my gym session to Wednesday", items, "2026-11-02", 0)).toBeNull();
    expect(quickAnswer("What should I do today?", items, "2026-11-02", 0)).toBeNull();
    expect(quickAnswer("Is my schedule realistic?", items, "2026-11-02", 0)).toBeNull();
  });
});
