"use client";

import { AlarmClock, Copy, MapPin, MoreHorizontal, Paperclip, Pencil, Repeat, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useTaskActions } from "@/hooks/use-planner";
import { diffDays, formatDateShort, formatTime12 } from "@/lib/dates";
import { KIND_LABEL, PRIORITY_LABEL, type ScheduleItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePlannerUI } from "./planner-ui";

export const PRIORITY_BADGE = {
  LOW: "secondary",
  MEDIUM: "outline",
  HIGH: "warning",
  URGENT: "destructive",
} as const;

export function DeadlineBadge({ date, today }: { date: string; today: string }) {
  const d = diffDays(today, date);
  const label = d < 0 ? `Overdue ${-d}d` : d === 0 ? "Due today" : d === 1 ? "Due tomorrow" : `Due ${formatDateShort(date)}`;
  return (
    <Badge variant={d < 0 ? "destructive" : d <= 1 ? "warning" : "outline"}>
      <AlarmClock /> {label}
    </Badge>
  );
}

export function TaskCard({
  item,
  today,
  compact,
  showDate,
  dragging,
  className,
}: {
  item: ScheduleItem;
  today: string;
  compact?: boolean;
  showDate?: boolean;
  dragging?: boolean;
  className?: string;
}) {
  const { openTask } = usePlannerUI();
  const { toggleComplete, duplicate, remove } = useTaskActions();
  const color = item.subject?.color ?? item.category?.color ?? "#94a3b8";
  const isFixed = item.kind === "CLASS" || item.kind === "MEETING" || item.kind === "EXAM";

  return (
    <div
      className={cn(
        "group relative flex gap-2.5 rounded-lg border bg-card p-2.5 text-left shadow-xs transition-all hover:shadow-md",
        item.completed && "opacity-60",
        dragging && "rotate-2 shadow-xl ring-2 ring-primary/40",
        className,
      )}
      onClick={() => openTask({ item })}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && openTask({ item })}
    >
      <span className="absolute inset-y-2 left-0 w-1 rounded-r-full" style={{ background: color }} />
      <div className="pt-0.5 pl-1" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        {isFixed ? (
          <span className="mt-0.5 block size-[18px] rounded-full border-2" style={{ borderColor: color, background: `${color}22` }} title={KIND_LABEL[item.kind]} />
        ) : (
          <Checkbox checked={item.completed} onCheckedChange={() => toggleComplete(item)} aria-label={item.completed ? "Mark as not done" : "Mark as done"} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm leading-snug font-medium break-words", item.completed && "line-through")}>{item.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {showDate && item.date && <span>{formatDateShort(item.date)}</span>}
          {item.startTime && (
            <span className="font-medium text-foreground/70 tabular-nums">
              {formatTime12(item.startTime)}
              {item.endTime && !compact ? `–${formatTime12(item.endTime)}` : ""}
            </span>
          )}
          {!compact && item.category && (
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ background: item.category.color }} />
              {item.subject?.name ?? item.category.name}
            </span>
          )}
          {item.isRecurring && <Repeat className="size-3" aria-label="Repeats" />}
          {item.attachmentCount > 0 && <Paperclip className="size-3" aria-label="Has attachments" />}
          {item.location && !compact && (
            <span className="flex items-center gap-0.5 truncate">
              <MapPin className="size-3" />
              {item.location}
            </span>
          )}
        </div>
        {(item.priority === "HIGH" || item.priority === "URGENT" || (item.deadlineDate && !item.completed) || item.kind !== "TASK") && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.kind !== "TASK" && <Badge variant="secondary">{KIND_LABEL[item.kind]}</Badge>}
            {(item.priority === "HIGH" || item.priority === "URGENT") && <Badge variant={PRIORITY_BADGE[item.priority]}>{PRIORITY_LABEL[item.priority]}</Badge>}
            {item.deadlineDate && !item.completed && <DeadlineBadge date={item.deadlineDate} today={today} />}
          </div>
        )}
      </div>
      <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded p-0.5 text-muted-foreground opacity-100 transition hover:bg-muted hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100" aria-label="Task actions">
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => openTask({ item })}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => duplicate.mutate(item)}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => (item.isRecurring ? openTask({ item }) : confirm(`Delete "${item.title}"?`) && remove.mutate({ item }))}>
              <Trash2 /> {item.isRecurring ? "Delete…" : "Delete"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
