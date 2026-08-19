// Instant loading skeleton shown inside the app shell while a page's server
// data (getComputed) is being prepared. The sidebar and top bar stay put; only
// the content area pulses.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="h-7 w-56 rounded bg-surface-low" />
        <div className="h-4 w-80 rounded bg-surface-low" />
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-5">
            <div className="mb-3 h-3 w-24 rounded bg-surface-low" />
            <div className="h-7 w-32 rounded bg-surface-low" />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-4 h-4 w-40 rounded bg-surface-low" />
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-4 rounded bg-surface-low" style={{ width: `${95 - i * 6}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
