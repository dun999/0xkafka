import type { Category } from '../markets/categories';
import { categoryIn } from '../picks/signals';

// Things the chat can do besides talk: buy 0xkafka's call, or seal your own pick.
// The app shows buttons for them under the answer; every payment goes over MPP.
// The server spots the obvious requests itself; for the rest, the model may end
// its answer with one tag, e.g. [[signals:sports]] or [[pick:5975212]].

export type ChatAction = { kind: 'signals' | 'picks'; category: Category | null; q: string | null } | { kind: 'pick'; id: string };

const SIGNAL_WORD = /\b(signals?|tips?)\b/i;
const WANT = /\b(buy|purchase|get|grab|sell|selling|for sale|want|need|show|list|give|have|available|any|see|unlock|open|price|cost|cheap)\b/i;
const BUY_CALL = /\b(buy|purchase|grab|unlock|sell me|get me)\b[^.?!]{0,30}\b(your|kafka'?s?|0xkafka'?s?)\s+(\w+\s+)?(calls?|picks?|predictions?|forecasts?|takes?|signals?)\b/i;
const PLACE = /\b(place|make|seal|post|submit|put in|lock in|log)\b[^.?!]{0,40}\b(picks?|bets?|predictions?)\b/i;
const WANT_TO_PICK = /\b(i want to|i'd like to|i wanna|let me|can i|i will|i'll)\s+(bet|pick|predict|seal|back)\b|\b(bet|wager)\s+on\b/i;

/** The action a message plainly asks for, if any. */
export function detectAction(message: string): ChatAction | null {
  const m = message.trim();
  const category = categoryIn(m);
  if ((SIGNAL_WORD.test(m) && WANT.test(m)) || BUY_CALL.test(m)) return { kind: 'signals', category, q: m };
  if (PLACE.test(m) || WANT_TO_PICK.test(m)) return { kind: 'picks', category, q: m };
  return null;
}

const TAG = /\[\[\s*(signals|picks|pick)(?::\s*([A-Za-z0-9_-]+))?\s*\]\]/;

/** A tag the model ended its answer with, read the same way the client reads it. */
export function actionFromTag(answer: string): ChatAction | null {
  const t = TAG.exec(answer);
  if (!t) return null;
  if (t[1] === 'pick') return t[2] ? { kind: 'pick', id: t[2] } : { kind: 'picks', category: null, q: null };
  return { kind: t[1] as 'signals' | 'picks', category: categoryIn(t[2] ?? ''), q: null };
}

/** What the prompt tells the model about the buttons. */
export function actionPrompt(shown: ChatAction | null, price: string, rows: string[] = []): string {
  const facts = `APP ACTIONS
Your signal on any open question is for sale for ${price} USDC, paid over MPP (the Machine Payments Protocol: USDC on Sui, straight from the asker's wallet to yours, verified on chain). If you haven't made the signal yet, buying it makes you make it now. The asker can also make their own prediction for free, right here in the chat.`;
  if (shown) {
    const what =
      shown.kind === 'signals'
        ? `your signals for sale${shown.category ? ` in ${shown.category}` : ''}, each with its price and a buy button`
        : shown.kind === 'picks'
          ? `open questions${shown.category ? ` in ${shown.category}` : ''} where they can make their own prediction`
          : 'the prediction form for that question';
    const list = rows.length ? ` It lists: ${rows.join('; ')}.` : ' The list is empty right now; say so in one sentence.';
    return `${facts}\nThe asker asked for this, and the app is showing ${what} right under your answer.${shown.kind === 'pick' ? '' : list} Reply with ONE short sentence that hands it over, e.g. "Here are my sports signals; pick one and I'll confirm the payment." No caveats, no record, no list, no numbers, no [[...]] tag, and don't claim anything was bought or saved.`;
  }
  return `${facts}
The app can put buttons under your answer. When, and only when, the asker wants to buy your signal or make a prediction, end your answer with exactly one tag on its own line:
[[signals]] or [[signals:sports]] (also politics, crypto, economy, culture): your signals for sale with buy buttons.
[[picks]] or [[picks:sports]]: open questions they can predict on.
[[pick:<question id>]]: the prediction form for one open question from the context.
Never describe how to pay; the buttons do it. Never claim anything was bought or saved.`;
}
