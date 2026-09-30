// B3: reads chained week by week from the start of the flight, so each week's
// calls know last week's (the hold bars in config calls.hold). Pure.
import type { WeeklyConfig } from './config.js';
import { readWeek, type Read } from './model.js';
import { aggregate, weekOf, addDays, type MetricRow, type WindowResult } from './window.js';

export interface SeriesResult { read: Read; prev: Read | null; win: WindowResult; reads: Read[] }

// Cumulative reads from `since` to the end of each Monday–Sunday week, up to weekEnd.
export function readSeries(rows: MetricRow[], since: string, weekEnd: string, cfg: WeeklyConfig, opts: { quotesAvailable: boolean; historic?: boolean }): SeriesResult {
  const reads: Read[] = [];
  let prev: Read | null = null;
  let win: WindowResult | null = null;
  const ends: string[] = [];
  for (let e = weekOf(since).end; e < weekEnd; e = addDays(e, 7)) ends.push(e);
  ends.push(weekEnd);
  for (const e of ends) {
    win = aggregate(rows, since, e, { historic: opts.historic });
    const r = readWeek(win.ads, cfg, { from: since, to: e, quotesAvailable: opts.quotesAvailable && win.quotes_seen, prev });
    reads.push(r);
    prev = r;
  }
  return { read: reads[reads.length - 1], prev: reads.length > 1 ? reads[reads.length - 2] : null, win: win!, reads };
}
