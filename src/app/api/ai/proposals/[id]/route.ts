import { z } from "zod";
import { acceptProposal, rejectProposal } from "@/lib/ai/actions";
import { authed, json, parseBody } from "@/lib/http";

const bodySchema = z.object({ decision: z.enum(["accept", "reject"]), selected: z.array(z.number().int().min(0).max(24)).optional() }).strict();

/** The only path by which AI-proposed changes are applied — always an explicit user action. */
export const POST = authed<{ id: string }>(async (req, user, { id }) => {
  const body = await parseBody(req, bodySchema);
  if (body.decision === "reject") {
    await rejectProposal(user.id, id);
    return json({ ok: true, status: "REJECTED" });
  }
  const { results } = await acceptProposal(user.id, id, body.selected);
  return json({ ok: true, status: "ACCEPTED", results });
});
