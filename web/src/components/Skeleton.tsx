/**
 * Placeholder blocks shown while the first read is in flight.
 *
 * Only the *first* load shows these — a poll that fails leaves the last good
 * data on screen instead of flashing back to skeletons.
 */
export function Skeleton({ width = '100%', height = 16 }: { width?: string | number; height?: number }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

export function CircleCardSkeleton() {
  return (
    <article className="card circle-card" aria-busy="true">
      <Skeleton width="60%" height={18} />
      <Skeleton width="35%" height={12} />
      <div className="progress">
        <div className="progress__fill" style={{ width: '0%' }} />
      </div>
      <Skeleton width="80%" height={12} />
    </article>
  );
}

export function StatsBarSkeleton() {
  return (
    <section className="card stats" aria-busy="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="stats__item">
          <Skeleton width="50%" height={22} />
          <Skeleton width="70%" height={11} />
        </div>
      ))}
    </section>
  );
}
