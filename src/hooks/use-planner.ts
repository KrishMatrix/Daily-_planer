"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, FetchError } from "@/lib/utils";
import type { CategoryDTO, Insight, ScheduleItem, SettingsDTO } from "@/lib/types";
import type { TaskCreateInput, TaskUpdateInput } from "@/lib/validation";

// Every view (dashboard, weekly board, calendar, university, work) reads from
// the same ["items", …] query family, so a change anywhere shows up everywhere.

export const keys = {
  items: ["items"] as const,
  range: (start: string, end: string) => ["items", "range", start, end] as const,
  open: ["items", "open"] as const,
  completed: ["items", "completed"] as const,
  category: (key: string) => ["items", "category", key] as const,
  categories: ["categories"] as const,
  settings: ["settings"] as const,
  stats: ["stats"] as const,
};

export function useRange(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: keys.range(start, end),
    queryFn: () => api<{ items: ScheduleItem[] }>(`/api/tasks?start=${start}&end=${end}`).then((r) => r.items),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useOpenTasks() {
  return useQuery({ queryKey: keys.open, queryFn: () => api<{ items: ScheduleItem[] }>("/api/tasks?view=open").then((r) => r.items) });
}

export function useCompletedTasks(enabled = true) {
  return useQuery({ queryKey: keys.completed, queryFn: () => api<{ items: ScheduleItem[] }>("/api/tasks?view=completed").then((r) => r.items), enabled });
}

export function useCategoryTasks(key: string) {
  return useQuery({ queryKey: keys.category(key), queryFn: () => api<{ items: ScheduleItem[] }>(`/api/tasks?view=category&key=${key}`).then((r) => r.items) });
}

export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: () => api<{ categories: CategoryDTO[] }>("/api/categories").then((r) => r.categories),
    staleTime: 5 * 60_000,
  });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api<{ settings: SettingsDTO }>("/api/settings").then((r) => r.settings), staleTime: 5 * 60_000 });
}

function patchCaches(qc: QueryClient, id: string, patch: (i: ScheduleItem) => ScheduleItem | null) {
  qc.setQueriesData<ScheduleItem[]>({ queryKey: keys.items }, (old) => {
    if (!Array.isArray(old)) return old;
    let changed = false;
    const next: ScheduleItem[] = [];
    for (const i of old) {
      if (i.id === id) {
        changed = true;
        const p = patch(i);
        if (p) next.push(p);
      } else next.push(i);
    }
    return changed ? next : old;
  });
}

/** Open the assistant with a prompt (handled by PlannerUIProvider). Nothing is sent to the AI until the panel sends it. */
export function askAssistant(prompt: string) {
  window.dispatchEvent(new CustomEvent("planner:ask-ai", { detail: prompt }));
}

export function invalidateAll(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: keys.items });
  qc.invalidateQueries({ queryKey: keys.stats });
}

type UpdateVars = { item: ScheduleItem; changes: TaskUpdateInput; scope?: "occurrence" | "series"; silent?: boolean };

export function useTaskActions() {
  const qc = useQueryClient();

  const showInsights = (insights: Insight[] | undefined, apply: (itemId: string, changes: Record<string, unknown>) => void) => {
    for (const ins of insights ?? []) {
      const ask = ins.askAi ? { label: "Ask AI", onClick: () => askAssistant(ins.askAi!) } : undefined;
      const opts = {
        duration: 12_000,
        action: ins.fix ? { label: ins.fix.label, onClick: () => apply(ins.fix!.itemId, ins.fix!.changes) } : ask,
        cancel: ins.fix ? ask : undefined,
      };
      if (ins.level === "warning") toast.warning(ins.message, opts);
      else toast.info(ins.message, opts);
    }
  };

  const applyFix = async (itemId: string, changes: Record<string, unknown>) => {
    try {
      await api(`/api/tasks/${encodeURIComponent(itemId)}`, { method: "PATCH", body: { changes, scope: "occurrence" } });
      toast.success("Updated");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      invalidateAll(qc);
    }
  };

  const create = useMutation({
    mutationFn: (input: Partial<TaskCreateInput> & { title: string }) => api<{ item: ScheduleItem; insights: Insight[] }>("/api/tasks", { method: "POST", body: input }),
    onSuccess: (res) => {
      toast.success(`Added "${res.item.title}"`);
      showInsights(res.insights, applyFix);
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => invalidateAll(qc),
  });

  const update = useMutation({
    mutationFn: ({ item, changes, scope }: UpdateVars) =>
      api<{ item: ScheduleItem; insights: Insight[] }>(`/api/tasks/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: { changes, scope: scope ?? "occurrence", version: item.occurrenceDate ? undefined : item.version },
      }),
    onMutate: async ({ item, changes, scope }) => {
      await qc.cancelQueries({ queryKey: keys.items });
      const snapshot = qc.getQueriesData({ queryKey: keys.items });
      if (scope !== "series") patchCaches(qc, item.id, (i) => ({ ...i, ...(changes as Partial<ScheduleItem>) }));
      return { snapshot };
    },
    onError: (e, _vars, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      if (e instanceof FetchError && e.status === 409) toast.info(e.message);
      else toast.error((e as Error).message);
    },
    onSuccess: (res, vars) => {
      if (!vars.silent) showInsights(res.insights, applyFix);
    },
    onSettled: () => invalidateAll(qc),
  });

  const remove = useMutation({
    mutationFn: ({ item, scope }: { item: ScheduleItem; scope?: "occurrence" | "series" }) =>
      api(`/api/tasks/${encodeURIComponent(item.id)}?scope=${scope ?? "occurrence"}`, { method: "DELETE" }),
    onMutate: async ({ item, scope }) => {
      await qc.cancelQueries({ queryKey: keys.items });
      const snapshot = qc.getQueriesData({ queryKey: keys.items });
      if (scope !== "series") patchCaches(qc, item.id, () => null);
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error((e as Error).message);
    },
    onSuccess: (_r, { item }) => toast.success(`Deleted "${item.title}"`),
    onSettled: () => invalidateAll(qc),
  });

  const duplicate = useMutation({
    mutationFn: (item: ScheduleItem) => api<{ item: ScheduleItem }>(`/api/tasks/${encodeURIComponent(item.id)}/duplicate`, { method: "POST" }),
    onSuccess: (r) => toast.success(`Duplicated as "${r.item.title}"`),
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => invalidateAll(qc),
  });

  const toggleComplete = (item: ScheduleItem) => update.mutate({ item, changes: { completed: !item.completed }, silent: true });

  return { create, update, remove, duplicate, toggleComplete };
}
