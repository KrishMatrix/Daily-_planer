"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ScheduleItem } from "@/lib/types";
import type { TaskCreateInput } from "@/lib/validation";

export type TaskDialogState = { item?: ScheduleItem; defaults?: Partial<TaskCreateInput> } | null;

type Ctx = {
  taskDialog: TaskDialogState;
  openTask: (s?: { item?: ScheduleItem; defaults?: Partial<TaskCreateInput> }) => void;
  closeTask: () => void;
  chatOpen: boolean;
  chatPrompt: string | null;
  /** Docked assistant panel on wide screens. */
  dockOpen: boolean;
  setDockOpen: (open: boolean) => void;
  openChat: (prompt?: string) => void;
  setChatOpen: (open: boolean) => void;
  consumeChatPrompt: () => string | null;
  planOpen: boolean;
  setPlanOpen: (open: boolean) => void;
  /** Date being planned (null = today). */
  planDate: string | null;
  openPlan: (date?: string) => void;
  reviewOpen: boolean;
  setReviewOpen: (open: boolean) => void;
};

const PlannerUI = createContext<Ctx | null>(null);

export function PlannerUIProvider({ children }: { children: React.ReactNode }) {
  const [taskDialog, setTaskDialog] = useState<TaskDialogState>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPrompt, setChatPrompt] = useState<string | null>(null);
  const [planOpen, setPlanOpenState] = useState(false);
  const [planDate, setPlanDate] = useState<string | null>(null);
  const setPlanOpen = useCallback((open: boolean) => {
    if (open) setPlanDate(null);
    setPlanOpenState(open);
  }, []);
  const openPlan = useCallback((date?: string) => {
    setPlanDate(date ?? null);
    setPlanOpenState(true);
  }, []);
  const [reviewOpen, setReviewOpen] = useState(false);

  const openTask = useCallback((s?: { item?: ScheduleItem; defaults?: Partial<TaskCreateInput> }) => setTaskDialog(s ?? {}), []);
  const closeTask = useCallback(() => setTaskDialog(null), []);
  const [dockOpen, setDockOpenState] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("lp-dock") === "0") setDockOpenState(false);
    } catch {}
  }, []);
  const setDockOpen = useCallback((open: boolean) => {
    setDockOpenState(open);
    try {
      localStorage.setItem("lp-dock", open ? "1" : "0");
    } catch {}
  }, []);
  // Wide screens use the docked panel; smaller ones the slide-over sheet.
  const openChat = useCallback(
    (prompt?: string) => {
      setChatPrompt(prompt ?? null);
      if (window.matchMedia("(min-width: 1280px)").matches) setDockOpen(true);
      else setChatOpen(true);
    },
    [setDockOpen],
  );
  // Insight toasts ask for deeper AI analysis through a DOM event (see askAssistant()).
  useEffect(() => {
    const onAsk = (e: Event) => openChat((e as CustomEvent<string>).detail);
    window.addEventListener("planner:ask-ai", onAsk);
    return () => window.removeEventListener("planner:ask-ai", onAsk);
  }, [openChat]);
  const consumeChatPrompt = useCallback(() => {
    const p = chatPrompt;
    setChatPrompt(null);
    return p;
  }, [chatPrompt]);

  const value = useMemo(
    () => ({ taskDialog, openTask, closeTask, chatOpen, chatPrompt, dockOpen, setDockOpen, openChat, setChatOpen, consumeChatPrompt, planOpen, setPlanOpen, planDate, openPlan, reviewOpen, setReviewOpen }),
    [taskDialog, openTask, closeTask, chatOpen, chatPrompt, dockOpen, setDockOpen, openChat, consumeChatPrompt, planOpen, setPlanOpen, planDate, openPlan, reviewOpen],
  );
  return <PlannerUI.Provider value={value}>{children}</PlannerUI.Provider>;
}

export function usePlannerUI() {
  const ctx = useContext(PlannerUI);
  if (!ctx) throw new Error("usePlannerUI must be used inside PlannerUIProvider");
  return ctx;
}
