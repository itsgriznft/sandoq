import { useEffect, useState } from 'react';

import { secondsLeft } from '../config';

function format(seconds: number): string {
  if (seconds <= 0) return 'closed';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = seconds % 60;

  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * A live-ticking countdown to a unix `deadline`.
 *
 * Below the last day it counts seconds, so a member watching a round close
 * sees it move — the reminder users asked for. Re-renders once a second; that
 * is cheap for a single element and only mounts when a round is actually open.
 */
export function Countdown({ deadline }: { deadline: bigint }) {
  const [left, setLeft] = useState(() => secondsLeft(deadline));

  useEffect(() => {
    setLeft(secondsLeft(deadline));
    const timer = setInterval(() => setLeft(secondsLeft(deadline)), 1_000);
    return () => clearInterval(timer);
  }, [deadline]);

  // Under a day left is the "act now" window the reminder is really for.
  const urgent = left > 0 && left < 86_400;

  return (
    <time className={`countdown ${urgent ? 'countdown--urgent' : ''} ${left <= 0 ? 'countdown--over' : ''}`}>
      {format(left)}
    </time>
  );
}
