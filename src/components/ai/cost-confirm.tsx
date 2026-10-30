"use client";

import { FetchError } from "@/lib/utils";
import type { useConfirm } from "../confirm-dialog";

/**
 * Run an AI request; if the server reports it may exceed the user's cost
 * threshold (HTTP 428), ask for confirmation with the estimate and retry.
 */
export async function withCostConfirm<T>(run: (confirmed: boolean) => Promise<T>, confirm: ReturnType<typeof useConfirm>["confirm"]): Promise<T | null> {
  try {
    return await run(false);
  } catch (e) {
    if (e instanceof FetchError && e.status === 428) {
      const est = Number(e.data.estimateUsd ?? 0);
      const tokens = Number(e.data.estimatedTokens ?? 0);
      const ok = await confirm({
        title: "Confirm AI request",
        description: `This request is estimated at about $${est < 0.01 ? est.toFixed(4) : est.toFixed(2)} (~${tokens.toLocaleString()} tokens). Estimates are approximate. Continue?`,
        confirmLabel: "Continue",
      });
      if (!ok) return null;
      return run(true);
    }
    throw e;
  }
}
