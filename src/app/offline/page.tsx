export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-4xl">📡</div>
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This page hasn&apos;t been saved for offline use yet. Pages you&apos;ve opened before are available offline (read-only). Reconnect to make changes.
      </p>
      <a href="/" className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        Try again
      </a>
    </div>
  );
}
