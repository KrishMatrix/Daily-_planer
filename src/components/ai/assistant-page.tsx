"use client";

import Link from "next/link";
import { Bot, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlannerUI } from "../planner-ui";
import { AssistantHeader, ChatConversation } from "./chat-panel";

/** Full-page assistant (same conversation as the side panel). */
export function AssistantPage() {
  const { setPlanOpen, setReviewOpen } = usePlannerUI();
  return (
    <div className="mx-auto flex h-[calc(100dvh-10.5rem)] max-w-3xl flex-col gap-3 lg:h-[calc(100dvh-6.5rem)]">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setPlanOpen(true)} className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:opacity-95">
          <Sparkles /> Plan my day
        </Button>
        <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>
          <TrendingUp /> Review my week
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" asChild>
          <Link href="/settings/ai">
            <Bot /> AI settings & usage
          </Link>
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
        <AssistantHeader />
        <ChatConversation />
      </div>
    </div>
  );
}
