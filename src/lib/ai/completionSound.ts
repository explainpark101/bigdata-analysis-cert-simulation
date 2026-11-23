/** Short UI chime when an agent turn finishes (Web Audio, no asset file). */

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new Ctx();
  }
  return sharedCtx;
}

function tone(
  ctx: AudioContext,
  {
    frequency,
    start,
    duration,
    gain = 0.08,
  }: { frequency: number; start: number; duration: number; gain?: number },
) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Pleasant two-note completion chime. Safe to call without awaiting. */
export async function playCompletionSound(): Promise<void> {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    tone(ctx, { frequency: 880, start: t0, duration: 0.12, gain: 0.07 });
    tone(ctx, { frequency: 1318.5, start: t0 + 0.11, duration: 0.22, gain: 0.09 });
  } catch {
    // Autoplay / AudioContext restrictions — ignore
  }
}
