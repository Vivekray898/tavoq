export const metadata = { title: "Offline — Taskora" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 rounded-full bg-muted p-4">
        <svg
          className="size-7 text-muted-foreground"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 2a10 10 0 1 0 10 10" />
          <path d="m22 2-20 20" />
          <path d="M17 5.5a9.5 9.5 0 0 0-5-1.5" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Some actions may be unavailable. Check your connection and try again.
      </p>
    </div>
  );
}
