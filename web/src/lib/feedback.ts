/**
 * User feedback collection, self-contained and backend-optional.
 *
 * A submission is kept in a local ring buffer so the in-app panel can always
 * show what was said, and — when `VITE_FEEDBACK_URL` points at a form backend
 * (Formspree, Formcarry, a Google Form's formResponse endpoint, or your own) —
 * it is POSTed there too, so responses from every visitor's browser aggregate
 * in one place you control.
 *
 * It also rides the analytics pipe as a `feedback` event, so a submission
 * shows up in the monitoring stream like any other.
 */

import { track } from './analytics';

export type Sentiment = 1 | 2 | 3 | 4 | 5;
export type Role = 'organizer' | 'member' | 'exploring';

export interface Feedback {
  at: number;
  sentiment: Sentiment;
  role: Role;
  message: string;
  /** The connected wallet, when there is one — never required. */
  address?: string;
}

const ENDPOINT = import.meta.env.VITE_FEEDBACK_URL as string | undefined;
const STORE_KEY = 'sandoq.feedback.v1';
const MAX_STORED = 100;

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  1: 'Confusing',
  2: 'Rough',
  3: 'Okay',
  4: 'Good',
  5: 'Loved it',
};

export const ROLE_LABELS: Record<Role, string> = {
  organizer: 'Started a circle',
  member: 'Joined a circle',
  exploring: 'Just exploring',
};

function readStore(): Feedback[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Feedback[]) : [];
  } catch {
    return [];
  }
}

function writeStore(items: Feedback[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items.slice(-MAX_STORED)));
  } catch {
    // Private mode / full quota — collection is best-effort, never fatal.
  }
}

/**
 * Record a piece of feedback. Resolves to `true` if a configured backend
 * accepted it, `false` if it was only stored locally (still a success from the
 * user's point of view). Never rejects — a failed POST must not lose the note.
 */
export async function submitFeedback(input: {
  sentiment: Sentiment;
  role: Role;
  message: string;
  address?: string;
}): Promise<boolean> {
  const entry: Feedback = { ...input, at: Date.now() };

  writeStore([...readStore(), entry]);
  track('feedback', { sentiment: entry.sentiment, role: entry.role });

  if (!ENDPOINT) return false;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sentiment: `${entry.sentiment} — ${SENTIMENT_LABELS[entry.sentiment]}`,
        role: ROLE_LABELS[entry.role],
        message: entry.message,
        address: entry.address ?? '',
        app: 'sandoq',
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Submissions made in this browser, newest first — what the panel lists. */
export function feedbackHistory(): Feedback[] {
  return readStore().reverse();
}

export function averageSentiment(): number | null {
  const items = readStore();
  if (items.length === 0) return null;
  return items.reduce((sum, f) => sum + f.sentiment, 0) / items.length;
}

/** Whether a form backend is wired up for central collection. */
export const hasBackend = Boolean(ENDPOINT);
