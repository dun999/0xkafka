import type { PickDetail } from './board';

// The words that go with a shared prediction. A hidden one never shares its side or number.

const pct = (p: number) => `${Math.round(p * 100)}%`;

function lead(fromIso: string, toIso: string | null): string | null {
  if (!toIso) return null;
  const h = (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;
  if (!(h > 0)) return null;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)} days`;
}

export function headline(m: { event_title: string | null; question: string }) {
  return m.event_title && m.event_title.length < 70 && m.event_title !== m.question ? m.event_title : m.question;
}

/** "3h before kickoff", "2 days before it closed". */
export function sealedLead(d: PickDetail): string | null {
  const l = lead(d.letter.submitted_at, d.m.start_time ?? d.m.end_date);
  if (!l) return null;
  return `${l} before ${d.m.category === 'sports' && d.m.start_time ? 'kickoff' : 'it closed'}`;
}

/** The market's price for the side that was picked, when it was sealed. */
export function marketForPick(d: PickDetail): number | null {
  const p = d.letter.prediction;
  if (!p || p.market_at_submit === null) return null;
  return p.pick === d.m.outcome_a ? p.market_at_submit : 1 - p.market_at_submit;
}

/** Ready text for X, first person for the author. */
export function shareText(d: PickDetail, mine: boolean): string {
  const who = mine ? 'I' : d.letter.display;
  const p = d.letter.prediction;
  const l = sealedLead(d);
  const title = headline(d.m);
  if (d.letter.result && p) {
    const mk = marketForPick(d);
    const vs = mk === null ? '' : ` when the market said ${pct(mk)}`;
    const sealed = l ? ` Saved on Walrus ${l}.` : ' Saved on Walrus before the result.';
    return d.letter.result.win
      ? `Called it. ${p.pick} at ${pct(p.confidence)}${vs}.${sealed}`
      : `${mine ? 'Missed this one' : `${who} missed this one`}: ${p.pick} at ${pct(p.confidence)} on ${title}. It stays on the record.${sealed}`;
  }
  if (p) return `${mine ? 'My' : `${who}'s`} prediction: ${p.pick} at ${pct(p.confidence)} on ${title}.${l ? ` Saved on Walrus ${l}.` : ''}`;
  return `${who} made a prediction on ${title}. It's saved on Walrus and opens when predictions close.`;
}
