/**
 * emergencyAudio.ts — Web Audio API siren and voice co-pilot alerts for severe crash response
 */

class EmergencyAudioManager {
  private ctx: AudioContext | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  private isSirenActive = false;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public startSiren(): void {
    if (this.isSirenActive) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      this.isSirenActive = true;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(650, ctx.currentTime);

      // Modulate frequency between 650Hz and 1100Hz (Dual-tone SOS pattern)
      const now = ctx.currentTime;
      for (let i = 0; i < 30; i++) {
        osc.frequency.linearRampToValueAtTime(1100, now + i * 0.7 + 0.35);
        osc.frequency.linearRampToValueAtTime(650, now + (i + 1) * 0.7);
      }

      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      this.sirenOsc = osc;
      this.sirenGain = gain;
    } catch (e) {
      console.warn('Could not start emergency siren:', e);
    }
  }

  public stopSiren(): void {
    if (!this.isSirenActive) return;
    this.isSirenActive = false;
    try {
      if (this.sirenGain && this.ctx) {
        this.sirenGain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.15);
        setTimeout(() => {
          this.sirenOsc?.stop();
          this.sirenOsc?.disconnect();
          this.sirenGain?.disconnect();
          this.sirenOsc = null;
          this.sirenGain = null;
        }, 180);
      }
    } catch {
      this.sirenOsc = null;
      this.sirenGain = null;
    }
  }

  public speakEmergency(text: string): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.1;
      utterance.volume = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Emergency speech synthesis failed:', e);
    }
  }
}

export const emergencyAudio = new EmergencyAudioManager();
