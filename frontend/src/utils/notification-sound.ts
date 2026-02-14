let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/**
 * Play a short notification chime using Web Audio API.
 * Two-tone ascending beep (C5 → E5), ~200ms total.
 */
export function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime;

    // Gain envelope
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

    // First tone (C5 = 523 Hz)
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523, now);
    osc1.connect(gain);
    osc1.start(now);
    osc1.stop(now + 0.12);

    // Second tone (E5 = 659 Hz)
    const gain2 = ctx.createGain();
    gain2.connect(ctx.destination);
    gain2.gain.setValueAtTime(0.12, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659, now + 0.1);
    osc2.connect(gain2);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.25);
  } catch {
    // Ignore audio errors — not critical
  }
}
