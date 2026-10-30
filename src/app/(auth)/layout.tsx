import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSessionUser()) redirect("/");
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_10%_-10%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent),radial-gradient(50rem_30rem_at_110%_110%,color-mix(in_oklch,oklch(0.7_0.18_320)_14%,transparent),transparent)]" />
      {children}
    </div>
  );
}
