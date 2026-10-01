// The Ember wallet in the title bar (CONTRACT-PHASE4.md §4.20, §12.1, §12.4 K1; COMBAT.md §12):
// #wallet, a title-bar button with the balance, which opens the Chronicle. It only reads
// embers.walletView; the balance moves by embers.earn, spend and chartChunks alone.
import { walletView } from '../embers.js';
import { esc } from './panels.js';

export const id = 'wallet';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);
/** 1234 → '1,234'. */
export const commas = (n) => String(whole(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const GLYPH = '<svg class="wallet-glyph" viewBox="0 0 7 7" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges"><path d="M3 0h1v1h1v1h1v4H5v1H2V6H1V2h1V1h1z"/><path class="wallet-core" d="M3 3h1v3H3z"/></svg>';

/** The button's accessible name: 'Embers: 42 of 100. Open the Chronicle.' */
export function walletLabel(view) {
  const v = isRecord(view) ? view : {};
  return `Embers: ${whole(v.balance)} of ${whole(v.cap) || 100}. Open the Chronicle.`;
}

/** The tooltip: '42 of 100 in the wallet · 1,234 in all · 10 today'. */
export function walletTitle(view) {
  const v = isRecord(view) ? view : {};
  const today = isRecord(v.today) ? v.today : {};
  const parts = [`${whole(v.balance)} of ${whole(v.cap) || 100} in the wallet`, `${commas(v.lifetime)} in all`];
  if (whole(today.earned)) parts.push(`${whole(today.earned)} today`);
  return parts.join(' · ');
}

/** The wallet's contents (walletView's shape): the ember and the balance. */
export function buildWallet(view) {
  const v = isRecord(view) ? view : {};
  const full = whole(v.balance) >= (whole(v.cap) || 100);
  return `${GLYPH}<span class="wallet-n"${full ? ' data-full="true"' : ''}>${esc(whole(v.balance))}</span>`;
}

const NOOP = Object.freeze({ dispose() {}, refresh() {} });

/** Mounts #wallet: its balance on every 'state', and the Chronicle on a click. → { dispose(), refresh() }. */
export function mount(shell) {
  try {
    const doc = globalThis.document;
    const root = doc?.getElementById?.('wallet');
    if (!shell || !root) return NOOP;
    const offs = [];
    let last = '';
    const render = () => {
      const view = walletView(shell.state, shell.now(), { economy: shell.content?.()?.economy ?? null });
      const html = buildWallet(view);
      const key = `${html}|${walletTitle(view)}`;
      if (key === last) return;
      last = key;
      root.innerHTML = html;
      root.setAttribute('aria-label', walletLabel(view));
      root.setAttribute('title', walletTitle(view));
    };
    const onClick = () => shell.openPanel('chronicle');
    root.hidden = false;
    root.addEventListener('click', onClick);
    if (typeof shell.on === 'function') offs.push(shell.on('state', render));
    render();
    return {
      dispose() {
        for (const off of offs) if (typeof off === 'function') off();
        root.removeEventListener('click', onClick);
      },
      refresh() { last = ''; render(); },
    };
  } catch (err) {
    console.error('[MILO] wallet mount', err);
    return NOOP;
  }
}
