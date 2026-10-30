"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/utils";
import { Logo } from "./app-shell";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      if (mode === "signup") {
        await api("/api/auth/signup", {
          method: "POST",
          body: {
            name: String(form.get("name") ?? ""),
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        });
      } else {
        await api("/api/auth/login", { method: "POST", body: { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") } });
      }
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <Logo />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{mode === "login" ? "Welcome back" : "Create your planner"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{mode === "login" ? "Sign in to see your week." : "Your week, calendar and AI assistant in one place."}</p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-2xl border bg-card/80 p-6 shadow-xl backdrop-blur">
        {mode === "signup" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" required maxLength={80} />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "signup" ? 8 : 1} required />
          {mode === "signup" && <span className="text-[11px] text-muted-foreground">At least 8 characters.</span>}
        </div>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link href="/signup" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
