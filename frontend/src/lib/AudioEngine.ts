import type { StemOperation } from "../types";

/**
 * Web Audio API engine for real-time stem preview.
 *
 * Loads individual stem AudioBuffers, creates per-stem gain nodes,
 * and applies operation-based gain scheduling so the user hears
 * modifications instantly without a server round-trip.
 */
export class AudioEngine {
  private ctx: AudioContext;
  private masterGain: GainNode;

  // Original audio (for playback before stems are loaded)
  private originalBuffer: AudioBuffer | null = null;
  private originalSource: AudioBufferSourceNode | null = null;

  // Separated stems
  private stems: Map<
    string,
    { buffer: AudioBuffer; gain: GainNode }
  > = new Map();
  private stemSources: Map<string, AudioBufferSourceNode> = new Map();

  // Playback state
  private _isPlaying = false;
  private _startContextTime = 0;
  private _startOffset = 0;
  private _duration = 0;
  private _operations: StemOperation[] = [];

  // Callbacks
  private _onTimeUpdate: ((time: number) => void) | null = null;
  private _onPlayStateChange: ((playing: boolean) => void) | null = null;
  private _rafId: number | null = null;

  // Mode
  private _playbackMode: "original" | "stems" = "original";

  constructor() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
  }

  get duration(): number {
    return this._duration;
  }
  get isPlaying(): boolean {
    return this._isPlaying;
  }
  get currentTime(): number {
    if (!this._isPlaying) return this._startOffset;
    return Math.min(
      this._startOffset + (this.ctx.currentTime - this._startContextTime),
      this._duration
    );
  }
  get hasStemsLoaded(): boolean {
    return this.stems.size > 0;
  }

  // ── Loading ──────────────────────────────────────────────────────────

  async loadOriginal(url: string): Promise<void> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    this.originalBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this._duration = this.originalBuffer.duration;
    this._playbackMode = "original";
  }

  async loadStem(name: string, url: string): Promise<void> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

    const gain = this.ctx.createGain();
    gain.connect(this.masterGain);

    // Instrumental is the sum of drums+bass+other — never play it directly
    if (name === "instrumental") {
      gain.gain.value = 0;
    }

    this.stems.set(name, { buffer: audioBuffer, gain });
    this._duration = Math.max(this._duration, audioBuffer.duration);
    this._playbackMode = "stems";
  }

  // ── Playback ─────────────────────────────────────────────────────────

  play(offset?: number): void {
    if (this._isPlaying) this._stop();

    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    const startFrom = offset ?? this._startOffset;
    this._startOffset = startFrom;
    this._startContextTime = this.ctx.currentTime;

    if (this._playbackMode === "stems" && this.stems.size > 0) {
      this._playStems(startFrom);
    } else if (this.originalBuffer) {
      this._playOriginal(startFrom);
    }

    this._isPlaying = true;
    this._onPlayStateChange?.(true);
    this._tick();
  }

  pause(): void {
    if (!this._isPlaying) return;
    this._startOffset = this.currentTime;
    this._stop();
  }

  playPause(): void {
    if (this._isPlaying) this.pause();
    else this.play();
  }

  seek(time: number): void {
    const clamped = Math.max(0, Math.min(time, this._duration));
    const wasPlaying = this._isPlaying;
    if (wasPlaying) this._stop();
    this._startOffset = clamped;
    if (wasPlaying) this.play();
    this._onTimeUpdate?.(clamped);
  }

  // ── Operations ───────────────────────────────────────────────────────

  applyOperations(operations: StemOperation[]): void {
    this._operations = operations;
    if (this._isPlaying && this._playbackMode === "stems") {
      this._scheduleAllGains();
    }
  }

  // ── Peaks extraction ─────────────────────────────────────────────────

  getOriginalPeaks(numBuckets: number): Float32Array {
    if (!this.originalBuffer) return new Float32Array(numBuckets);
    return this._extractPeaks(this.originalBuffer, numBuckets);
  }

  getStemPeaks(stemName: string, numBuckets: number): Float32Array {
    const stem = this.stems.get(stemName);
    if (!stem) return new Float32Array(numBuckets);
    return this._extractPeaks(stem.buffer, numBuckets);
  }

  // ── Callbacks ────────────────────────────────────────────────────────

  set onTimeUpdate(cb: ((time: number) => void) | null) {
    this._onTimeUpdate = cb;
  }
  set onPlayStateChange(cb: ((playing: boolean) => void) | null) {
    this._onPlayStateChange = cb;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  dispose(): void {
    this._stop();
    this.ctx.close();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private _playOriginal(offset: number): void {
    const source = this.ctx.createBufferSource();
    source.buffer = this.originalBuffer!;
    source.connect(this.masterGain);
    source.start(0, offset);
    source.onended = () => this._handleEnded();
    this.originalSource = source;
  }

  private _playStems(offset: number): void {
    for (const [name, { buffer, gain }] of this.stems) {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(0, offset);
      this.stemSources.set(name, source);
    }

    this._scheduleAllGains();

    // Detect track end from the longest stem
    const firstSource = this.stemSources.values().next().value;
    if (firstSource) {
      firstSource.onended = () => this._handleEnded();
    }
  }

  private _stop(): void {
    if (this.originalSource) {
      try {
        this.originalSource.stop();
      } catch {
        /* already stopped */
      }
      this.originalSource = null;
    }
    for (const source of this.stemSources.values()) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.stemSources.clear();

    this._isPlaying = false;
    this._onPlayStateChange?.(false);
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  private _handleEnded(): void {
    if (this._isPlaying) {
      this._isPlaying = false;
      this._startOffset = 0;
      this._onPlayStateChange?.(false);
      this._onTimeUpdate?.(0);
    }
  }

  private _tick(): void {
    if (!this._isPlaying) return;
    const time = this.currentTime;
    if (time >= this._duration) {
      this._handleEnded();
      return;
    }
    this._onTimeUpdate?.(time);
    this._rafId = requestAnimationFrame(() => this._tick());
  }

  // ── Gain scheduling ──────────────────────────────────────────────────

  private _scheduleAllGains(): void {
    const contextNow = this.ctx.currentTime;
    const audioNow = this.currentTime;

    for (const [name, { gain }] of this.stems) {
      if (name === "instrumental") continue;

      const gainParam = gain.gain;
      gainParam.cancelScheduledValues(0);

      const currentGain = this._computeGainAtTime(name, audioNow);
      gainParam.setValueAtTime(currentGain, contextNow);

      const timeline = this._computeGainTimeline(name);
      for (const { time, gain: g } of timeline) {
        if (time > audioNow) {
          gainParam.setValueAtTime(g, contextNow + (time - audioNow));
        }
      }
    }
  }

  private _computeGainTimeline(
    stemName: string
  ): Array<{ time: number; gain: number }> {
    const boundaries = new Set<number>([0]);
    for (const op of this._operations) {
      boundaries.add(op.time_range.start);
      boundaries.add(op.time_range.end);
    }
    boundaries.add(this._duration);

    return [...boundaries]
      .sort((a, b) => a - b)
      .map((t) => ({ time: t, gain: this._computeGainAtTime(stemName, t) }));
  }

  private _computeGainAtTime(stemName: string, time: number): number {
    if (stemName === "instrumental") return 0;

    for (const op of this._operations) {
      if (time >= op.time_range.start && time < op.time_range.end) {
        if (op.action === "remove") {
          if (op.stem === stemName) return 0;
          if (op.stem === "instrumental" && stemName !== "vocals") return 0;
        } else if (op.action === "isolate") {
          if (op.stem === "instrumental") {
            if (stemName === "vocals") return 0;
          } else if (op.stem !== stemName) {
            return 0;
          }
        }
      }
    }
    return 1;
  }

  // ── Peaks ────────────────────────────────────────────────────────────

  private _extractPeaks(
    buffer: AudioBuffer,
    numBuckets: number
  ): Float32Array {
    // Average all channels for a representative waveform
    const numChannels = buffer.numberOfChannels;
    const length = buffer.length;
    const samplesPerBucket = length / numBuckets;
    const peaks = new Float32Array(numBuckets);

    for (let ch = 0; ch < numChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < numBuckets; i++) {
        let max = 0;
        const start = Math.floor(i * samplesPerBucket);
        const end = Math.min(
          Math.floor((i + 1) * samplesPerBucket),
          data.length
        );
        for (let j = start; j < end; j++) {
          const abs = Math.abs(data[j]!);
          if (abs > max) max = abs;
        }
        // Take the max across channels
        if (max > (peaks[i] ?? 0)) peaks[i] = max;
      }
    }

    return peaks;
  }
}
