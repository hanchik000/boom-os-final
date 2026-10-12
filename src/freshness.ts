// ---------------------------------------------------------------------------------------------
// "N назад" / "N ago" -- one wording for how old the data on a screen is.
//
// Introduced in Stage 35.9 for the manager command centre and moved here in Stage 44, when the
// kitchen, the pass and the kitchen control screens needed the same thing. It is
// presentation-only: it formats a CLIENT-side timestamp of the last SUCCESSFUL fetch, never a
// server value, and nothing it returns feeds back into a request or a calculation.
//
// `agoFragment` is the bare relative-time text (reused by a header indicator and by a stale
// notice); `timeAgoLabel` wraps it in "Обновлено …" for the indicator itself.
// ---------------------------------------------------------------------------------------------
export function agoFragment(ms: number, ru: boolean): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 5) return ru ? 'только что' : 'häzir';
  if (seconds < 60) return ru ? `${seconds} сек назад` : `${seconds} sek öň`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return ru ? `${minutes} мин назад` : `${minutes} min öň`;
  const hours = Math.floor(minutes / 60);
  return ru ? `${hours} ч назад` : `${hours} sag öň`;
}
export function timeAgoLabel(ms: number, ru: boolean): string {
  const frag = agoFragment(ms, ru);
  return ru ? `Обновлено ${frag}` : `${frag} täzelendi`;
}
