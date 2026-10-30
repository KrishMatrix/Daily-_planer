"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            // Cross-device sync: refetch when the app regains focus/connectivity and poll while visible.
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            refetchInterval: 30_000,
            retry: (count, err) => count < 2 && !(err && typeof err === "object" && "status" in err && (err as { status: number }).status < 500 && (err as { status: number }).status > 0),
          },
        },
      }),
  );

  useEffect(() => {
    // Keep the install prompt so Settings → Install app can show an "Install" button.
    const onPrompt = (e: Event) => {
      e.preventDefault();
      (window as { __lpInstallPrompt?: Event }).__lpInstallPrompt = e;
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("SW registration failed", e));
    }
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        {children}
        <Toaster richColors closeButton position="top-center" toastOptions={{ classNames: { toast: "rounded-xl" } }} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
