"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Options = { title: string; description?: string; confirmLabel?: string; destructive?: boolean; choices?: { label: string; value: string }[] };

/** Promise-based confirmation dialog: `if (await confirm({...})) …` */
export function useConfirm() {
  const [opts, setOpts] = useState<Options | null>(null);
  const resolver = useRef<((v: string | false) => void) | null>(null);

  const confirm = useCallback((o: Options) => {
    setOpts(o);
    return new Promise<string | false>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: string | false) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  const element = (
    <Dialog open={!!opts} onOpenChange={(o) => !o && close(false)}>
      <DialogContent className="sm:max-w-sm" hideClose>
        <DialogHeader>
          <DialogTitle>{opts?.title}</DialogTitle>
          {opts?.description && <DialogDescription>{opts.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          {opts?.choices ? (
            opts.choices.map((c, i) => (
              <Button key={c.value} variant={i === opts.choices!.length - 1 && opts.destructive ? "destructive" : i === 0 ? "secondary" : "default"} onClick={() => close(c.value)}>
                {c.label}
              </Button>
            ))
          ) : (
            <Button variant={opts?.destructive ? "destructive" : "default"} onClick={() => close("yes")}>
              {opts?.confirmLabel ?? "Confirm"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, element };
}
