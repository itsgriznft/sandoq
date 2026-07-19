import { formatXlm } from '../config';
import type { Stats } from '../lib/factory';

export function StatsBar({ stats, syncedAt }: { stats: Stats; syncedAt: Date | null }) {
  return (
    <section className="card stats">
      <div className="stats__item">
        <strong>{stats.circles}</strong>
        <span>{stats.circles === 1 ? 'circle' : 'circles'}</span>
      </div>
      <div className="stats__item">
        <strong>{stats.members}</strong>
        <span>{stats.members === 1 ? 'member' : 'members'}</span>
      </div>
      <div className="stats__item">
        <strong>{formatXlm(stats.committed, 0)}</strong>
        <span>XLM committed per rotation</span>
      </div>
      <div className="stats__item">
        <strong>
          {stats.filling}·{stats.active}·{stats.complete}
        </strong>
        <span>filling · running · done</span>
      </div>
      <span className="stats__sync" title="Read straight from the factory contract">
        {syncedAt ? `● synced ${syncedAt.toLocaleTimeString()}` : '○ syncing…'}
        {stats.aggregated < stats.circles && ` · first ${stats.aggregated} aggregated`}
      </span>
    </section>
  );
}
