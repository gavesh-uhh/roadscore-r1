'use client';

/**
 * DriverVoice — Dual Voice & Acoustic Chime Engine (DRIVER_VIEW_PLAN §3.5)
 *
 * A priority-preempted in-cabin audio engine:
 *  - Tier 1 (Safety Alerts):   cancels any background chatter, plays a
 *                              directional stereo chime, speaks urgent warnings.
 *  - Tier 2 (TrueScore™):      reassuring double-harmonic chime (C5 → G5) and
 *                              positive spoken feedback after hazard avoidance.
 *  - Tier 3 (Eco Advisories):  soft notification tone, lowest preemption rank.
 *
 * Built on Web Speech (speechSynthesis) + Web Audio synthesized chimes.
 * Must be `prime()`d from a user gesture before audio can play.
 */

export type AudioTier = 1 | 2 | 3;

export type ChimeKind = 'hazard' | 'exoneration' | 'eco' | 'harsh';

interface SpeakJob {
  text: string;
  tier: AudioTier;
}

class DriverVoiceEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private currentTier: AudioTier | null = null;
  private pending: SpeakJob[] = [];
  private speaking = false;
  private primed = false;
  private voice: SpeechSynthesisVoice | null = null;
  /** Identity of the utterance currently occupying the engine — lets the
   *  async onend/onerror of a PREEMPTED utterance be ignored instead of
   *  clobbering the state of its replacement. */
  private currentUtter: SpeechSynthesisUtterance | null = null;

  enabled = true;

  /** Call from a user gesture (Launch Co-Pilot) to unlock audio + speech. */
  prime(): void {
    if (typeof window === 'undefined') return;
    this.primed = true;

    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
          this.masterGain = this.ctx.createGain();
          this.masterGain.gain.value = 0.9;
          this.masterGain.connect(this.ctx.destination);
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
    } catch {
      // AudioContext unavailable — chimes disabled, TTS may still work
    }

    try {
      if ('speechSynthesis' in window) {
        // Warm the speech pipeline with a near-silent utterance so the first
        // real announcement does not lag, and pre-select a voice.
        const warm = new SpeechSynthesisUtterance(' ');
        warm.volume = 0.01;
        window.speechSynthesis.speak(warm);
        this.pickVoice();
        window.speechSynthesis.onvoiceschanged = () => this.pickVoice();
      }
    } catch {
      // Speech synthesis unavailable
    }
  }

  private pickVoice(): void {
    try {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      this.voice =
        voices.find((v) => /en[-_]US/i.test(v.lang) && /female|samantha|zira|google/i.test(v.name)) ||
        voices.find((v) => /^en/i.test(v.lang)) ||
        voices[0] ||
        null;
    } catch {
      this.voice = null;
    }
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.cancelAll();
  }

  cancelAll(): void {
    this.pending = [];
    this.currentTier = null;
    this.speaking = false;
    this.currentUtter = null;
    try {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }

  /**
   * Speak with strict priority preemption. A lower tier number always wins:
   * an incoming Tier 1 alert cancels Tier 2/3 speech instantly, while lower
   * priority jobs wait for the current announcement to finish.
   */
  speak(text: string, tier: AudioTier): void {
    if (!this.enabled || !this.primed || typeof window === 'undefined') return;
    if (!('speechSynthesis' in window)) return;

    // Preempt strictly-lower-priority speech (higher tier number).
    if (this.speaking && this.currentTier !== null && tier < this.currentTier) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
      this.pending = this.pending.filter((j) => j.tier <= tier);
      this.speaking = false;
      this.currentTier = null;
    }

    this.pending.push({ text, tier });
    // Keep the queue tight — stale eco chatter is worse than none.
    if (this.pending.length > 3) {
      this.pending.sort((a, b) => a.tier - b.tier);
      this.pending = this.pending.slice(0, 3);
    }
    this.pump();
  }

  private pump(): void {
    if (this.speaking || !this.enabled) return;
    // Always drain highest priority first.
    this.pending.sort((a, b) => a.tier - b.tier);
    const job = this.pending.shift();
    if (!job) return;

    try {
      const utter = new SpeechSynthesisUtterance(job.text);
      if (this.voice) utter.voice = this.voice;
      utter.rate = job.tier === 1 ? 1.08 : 1.0;
      utter.pitch = job.tier === 2 ? 1.05 : 1.0;
      utter.volume = 1;

      this.speaking = true;
      this.currentTier = job.tier;
      this.currentUtter = utter;

      const done = () => {
        // A preempted utterance's async onend/onerror must not touch the
        // state of whatever replaced it.
        if (this.currentUtter !== utter) return;
        this.currentUtter = null;
        this.speaking = false;
        this.currentTier = null;
        // Yield so a cancel() triggered preemption doesn't instantly re-speak.
        setTimeout(() => this.pump(), 60);
      };
      utter.onend = done;
      utter.onerror = done;

      window.speechSynthesis.speak(utter);
    } catch {
      this.currentUtter = null;
      this.speaking = false;
      this.currentTier = null;
    }
  }

  /** Synthesized chime dispatcher. `pan` ∈ [-1, 1] for directional audio. */
  chime(kind: ChimeKind, pan = 0): void {
    if (!this.enabled || !this.primed) return;
    if (!this.ctx || !this.masterGain) return;
    try {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      switch (kind) {
        case 'hazard':
          this.playHazard(pan);
          break;
        case 'exoneration':
          this.playExoneration();
          break;
        case 'eco':
          this.playEco();
          break;
        case 'harsh':
          this.playHarsh();
          break;
      }
    } catch {
      // Synthesis failures must never break the cockpit
    }
  }

  private makeVoice(pan: number): GainNode {
    const ctx = this.ctx!;
    const gain = ctx.createGain();

    // Directional stereo placement when supported.
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      panner.connect(this.masterGain!);
    } else {
      gain.connect(this.masterGain!);
    }
    return gain;
  }

  /**
   * Detach a chime's gain chain from the master bus once its last source
   * stops — without this every chime permanently leaks a GainNode (+panner)
   * onto the destination graph for the lifetime of the session.
   */
  private autoDisconnect(source: OscillatorNode, gain: GainNode): void {
    source.onended = () => {
      try {
        gain.disconnect();
      } catch {
        // already disconnected
      }
    };
  }


  /** Tier 1: urgent dual-oscillator sweep (A5 → D6) with stereo direction. */
  private playHazard(pan: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const gain = this.makeVoice(pan);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(1174.66, now + 0.12);
    osc2.frequency.setValueAtTime(440, now);
    osc2.frequency.exponentialRampToValueAtTime(587.33, now + 0.12);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

    osc1.connect(gain);
    osc2.connect(gain);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.42);
    osc2.stop(now + 0.42);

    // Repeat blip for urgency.
    const osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(1174.66, now + 0.18);
    const g3 = ctx.createGain();
    g3.gain.setValueAtTime(0.001, now + 0.18);
    g3.gain.linearRampToValueAtTime(0.14, now + 0.21);
    g3.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc3.connect(g3);
    g3.connect(gain);
    osc3.start(now + 0.18);
    osc3.stop(now + 0.52);
    this.autoDisconnect(osc3, gain); // last-stopping source frees the chain
  }

  /** Tier 2: gentle double-harmonic reassurance chime (C5 → G5). */
  private playExoneration(): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const gain = this.makeVoice(0);

    const notes: Array<{ freq: number; at: number }> = [
      { freq: 523.25, at: 0 }, // C5
      { freq: 783.99, at: 0.16 }, // G5
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const harm = ctx.createOscillator();
      osc.type = 'sine';
      harm.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, now + n.at);
      harm.frequency.setValueAtTime(n.freq * 2, now + n.at);

      const g = ctx.createGain();
      const gh = ctx.createGain();
      g.gain.setValueAtTime(0.001, now + n.at);
      g.gain.linearRampToValueAtTime(0.16, now + n.at + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, now + n.at + 0.7);
      gh.gain.setValueAtTime(0.001, now + n.at);
      gh.gain.linearRampToValueAtTime(0.05, now + n.at + 0.04);
      gh.gain.exponentialRampToValueAtTime(0.0001, now + n.at + 0.5);

      osc.connect(g);
      harm.connect(gh);
      g.connect(gain);
      gh.connect(gain);
      osc.start(now + n.at);
      harm.start(now + n.at);
      osc.stop(now + n.at + 0.75);
      harm.stop(now + n.at + 0.55);
      // The final G5 fundamental is the last-stopping source of the chime.
      if (n.at === 0.16) this.autoDisconnect(osc, gain);
    }
  }

  /** Tier 3: soft single eco notification blip. */
  private playEco(): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const gain = this.makeVoice(0);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(659.25, now); // E5
    osc.frequency.exponentialRampToValueAtTime(987.77, now + 0.14); // B5

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.55);
    this.autoDisconnect(osc, gain);
  }

  /** Harsh maneuver thud — low descending tone for the G-orb shockwave. */
  private playHarsh(): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const gain = this.makeVoice(0);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(196, now); // G3
    osc.frequency.exponentialRampToValueAtTime(98, now + 0.25);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.4);
    this.autoDisconnect(osc, gain);
  }

  /**
   * Convenience: chime (optionally directional) then speak, tier-aware.
   * Tier 1 alerts chime first, then speak once the chime tail decays.
   */
  announce(text: string, tier: AudioTier, opts?: { chime?: ChimeKind; pan?: number }): void {
    if (!this.enabled) return;
    const chime = opts?.chime ?? (tier === 1 ? 'hazard' : tier === 2 ? 'exoneration' : 'eco');
    this.chime(chime, opts?.pan ?? 0);
    const delay = tier === 1 ? 350 : 500;
    setTimeout(() => this.speak(text, tier), delay);
  }
}

/** Shared singleton engine for the whole cockpit. */
export const driverVoice = new DriverVoiceEngine();

