/** Placeholder shown while a page loads. Used by the loading.tsx files under (app). */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-7 w-32" />
      <div className="flex flex-col gap-3">
        <div className="skeleton h-5 w-28" />
        <div className="skeleton h-4 w-44" />
        <div className="rounded-md border border-edge bg-panel p-4">
          <div className="flex flex-col gap-4">
            {[0, 1, 2].map((row) => (
              <div key={row} className="skeleton h-4 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
