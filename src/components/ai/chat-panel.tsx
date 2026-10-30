"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Database, Loader2, PanelRightClose, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api, cn, FetchError, formatUsd } from "@/lib/utils";
import { usePlannerUI } from "../planner-ui";
import { useConfirm } from "../confirm-dialog";
import { withCostConfirm } from "./cost-confirm";
import { ProposalCard, type Proposal } from "./proposal-card";
import { AssistantInsights } from "./assistant-insights";

type Msg = { role: "user" | "assistant"; content: string; proposals?: Proposal[]; cost?: number; source?: "ai" | "rules" | "cache"; error?: boolean };

const SUGGESTIONS = [
  "What should I do today?",
  "What is my next class?",
  "What meetings do I have tomorrow?",
  "Which assignments are urgent?",
  "Find two hours for studying",
  "Is my schedule realistic?",
  "What can I postpone?",
  "Organize my week",
];

const STORAGE_KEY = "lp-chat";

// ── Shared conversation state (one conversation across the dock, the mobile sheet and /assistant) ──

type ChatCtx = { messages: Msg[]; busy: boolean; send: (text: string) => void; reset: () => void; markProposal: (id: string, status: string) => void };
const Chat = createContext<ChatCtx | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const { confirm, element: confirmEl } = useConfirm();
  const busyRef = useRef(false);
  const messagesRef = useRef<Msg[]>([]);
  messagesRef.current = messages;

  // Kept for this browser tab only — the real data lives in the database.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    } catch {}
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const history: Msg[] = [...messagesRef.current, { role: "user", content }];
      setMessages(history);
      try {
        const res = await withCostConfirm(
          (confirmed) =>
            api<{ reply: string; proposals: Proposal[]; usage: { costUsd: number }; source: Msg["source"] }>("/api/ai/chat", {
              method: "POST",
              body: { messages: history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })).slice(-12), confirmed },
            }),
          confirm,
        );
        if (!res) setMessages((m) => [...m, { role: "assistant", content: "Okay — I didn't send that request.", error: true }]);
        else setMessages((m) => [...m, { role: "assistant", content: res.reply, proposals: res.proposals, cost: res.usage.costUsd, source: res.source }]);
      } catch (e) {
        const msg = e instanceof FetchError ? e.message : "Something went wrong.";
        setMessages((m) => [...m, { role: "assistant", content: msg, error: true }]);
        if (e instanceof FetchError && e.status === 402) toast.error(msg);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [confirm],
  );

  const reset = useCallback(() => setMessages([]), []);
  // Remember accept/reject so a restored conversation doesn't offer the same proposal again.
  const markProposal = useCallback(
    (id: string, status: string) => setMessages((ms) => ms.map((m) => (m.proposals?.some((p) => p.id === id) ? { ...m, proposals: m.proposals.map((p) => (p.id === id ? { ...p, status } : p)) } : m))),
    [],
  );

  return (
    <Chat.Provider value={{ messages, busy, send, reset, markProposal }}>
      {children}
      {confirmEl}
    </Chat.Provider>
  );
}

/** Sends prompts requested elsewhere in the app (dashboard buttons, "Ask AI" on alerts) into the conversation. */
export function ChatPromptBridge() {
  const { chatPrompt, consumeChatPrompt } = usePlannerUI();
  const { send } = useChat();
  useEffect(() => {
    if (chatPrompt) {
      const p = consumeChatPrompt();
      if (p) send(p);
    }
  }, [chatPrompt, consumeChatPrompt, send]);
  return null;
}

export function useChat() {
  const c = useContext(Chat);
  if (!c) throw new Error("useChat must be used inside ChatProvider");
  return c;
}

/** Minimal markdown: **bold**, bullet lists and line breaks. Rendered as React nodes (no HTML injection). */
function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const inline = (s: string, k: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong> : part));
  const flush = (k: number) => {
    if (list.length) {
      out.push(
        <ul key={`ul-${k}`} className="my-1 list-disc space-y-0.5 pl-5">
          {list.map((l, i) => (
            <li key={i}>{inline(l, `li-${k}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((line, i) => {
    const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (m) list.push(m[1]);
    else {
      flush(i);
      if (line.trim()) out.push(<p key={i} className="my-1">{inline(line.replace(/^#+\s*/, ""), `p-${i}`)}</p>);
    }
  });
  flush(lines.length);
  return <>{out}</>;
}

/** The conversation itself: alerts, messages, proposals with Accept/Reject, suggestions and the input box. */
export function ChatConversation({ onNavigate, showInsights = true, className }: { onNavigate?: () => void; showInsights?: boolean; className?: string }) {
  const { messages, busy, send, markProposal } = useChat();
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const submit = () => {
    if (!input.trim() || busy) return;
    send(input);
    setInput("");
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col justify-end gap-4">
            {showInsights && <AssistantInsights />}
            <div className="text-center">
              <Sparkles className="mx-auto mb-2 size-7 text-violet-500" />
              <p className="font-medium">How can I help you plan?</p>
              <p className="mt-1 text-sm text-muted-foreground">I read your real schedule, find free time and propose changes for you to approve.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition hover:border-primary/40 hover:bg-accent">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {showInsights && <AssistantInsights compact />}
            {messages.map((m, i) => (
              <div key={i} className={cn("flex flex-col gap-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200", m.role === "user" ? "items-end" : "items-start")}>
                <div
                  className={cn(
                    "max-w-[88%] rounded-2xl px-3.5 py-2 text-sm",
                    m.role === "user" ? "rounded-br-md bg-primary text-primary-foreground" : m.error ? "rounded-bl-md bg-destructive/10 text-destructive" : "rounded-bl-md bg-muted",
                  )}
                >
                  {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
                  {m.error && m.content.includes("AI Settings") && (
                    <Link href="/settings/ai" className="mt-1 block text-xs underline" onClick={onNavigate}>
                      Open AI Settings
                    </Link>
                  )}
                </div>
                {m.proposals?.map((p) => (
                  <div key={p.id} className="w-full">
                    <ProposalCard proposal={p} onResolved={(st) => markProposal(p.id, st)} />
                  </div>
                ))}
                {m.source === "rules" && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Database className="size-3" /> Answered from your calendar · no AI cost
                  </span>
                )}
                {m.source === "cache" && <span className="text-[10px] text-muted-foreground">Same question, unchanged schedule · reused answer, no AI cost</span>}
                {m.source === "ai" && m.cost !== undefined && <span className="text-[10px] text-muted-foreground">≈ {formatUsd(m.cost)}</span>}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Checking your schedule…
              </div>
            )}
          </div>
        )}
      </div>

      <form
        className="pb-safe border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring/30">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about your schedule…"
            rows={1}
            maxLength={4000}
            className="max-h-32 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            aria-label="Message the assistant"
          />
          <Button type="submit" size="icon-sm" className="shrink-0 rounded-xl" disabled={busy || !input.trim()} aria-label="Send">
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function AssistantHeader({ actions }: { actions?: React.ReactNode }) {
  const { messages, reset } = useChat();
  return (
    <div className="flex items-center gap-2.5 border-b px-4 py-3">
      <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
        <Sparkles className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">AI assistant</div>
        <div className="truncate text-xs text-muted-foreground">Uses your real schedule · changes need your approval</div>
      </div>
      {messages.length > 0 && (
        <Button variant="ghost" size="icon-sm" onClick={reset} aria-label="New conversation" title="New conversation">
          <RotateCcw />
        </Button>
      )}
      {actions}
    </div>
  );
}

/** Right-hand panel on wide screens (xl+). */
export function AssistantDock() {
  const { setDockOpen } = usePlannerUI();
  return (
    <aside className="sticky top-0 hidden h-dvh w-[22rem] shrink-0 flex-col border-l bg-card/40 xl:flex 2xl:w-96" aria-label="AI assistant">
      <AssistantHeader
        actions={
          <Button variant="ghost" size="icon-sm" onClick={() => setDockOpen(false)} aria-label="Hide assistant panel" title="Hide panel">
            <PanelRightClose />
          </Button>
        }
      />
      <ChatConversation />
    </aside>
  );
}

/** Slide-over sheet for smaller screens (and wide screens with the panel hidden). */
export function ChatPanel() {
  const { chatOpen, setChatOpen } = usePlannerUI();
  return (
    <Sheet open={chatOpen} onOpenChange={setChatOpen}>
      <SheetContent className="pt-safe gap-0 sm:max-w-lg">
        <SheetTitle className="sr-only">AI assistant</SheetTitle>
        <SheetDescription className="sr-only">Answers from your real schedule; changes need your approval</SheetDescription>
        <div className="pr-10">
          <AssistantHeader />
        </div>
        <ChatConversation onNavigate={() => setChatOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
