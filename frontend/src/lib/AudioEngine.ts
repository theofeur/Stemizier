import type { StemOperation, AudioRegion } from "../types";

/**
 * Web Audio API engine for real-time stem preview with edit timeline support.
 *
 * Supports two playback approaches:
 * 1. Linear playback (no edits) — plays buffers straight through
 * 2. Timeline playback (with edits) — schedules buffer sources per region
 *
 * Stem operations (remove/isolate) use gain scheduling.
 * Edit timeline operations (cut/paste/delete) rearrange what audio plays when.
 */
export class AudioEngine {
  private ctx: AudioContext;
  private masterGain: GainNode;

  // Original audio (for playback before stems are loaded)
  private originalBuffer: AudioBuffer | null = null;
  private originalSource: AudioBufferSourceNode | null = null;

  // Original audio element (for Master Tempo mode)
  private originalAudioElement: HTMLAudioElement | null = null;
  private originalElementSource: MediaElementAudioSourceNode | null = null;

  // Separated stems
  private stems: Map<
    string,
    { buffer: AudioBuffer; gain: GainNode }
  > = new Map();
  private stemSources: Map<string, AudioBufferSourceNode> = new Map();

  // Stem audio elements (for Master Tempo mode)
  private stemAudioElements: Map<string, HTMLAudioElement> = new Map();
  private stemElementSources: Map<string, MediaElementAudioSourceNode> = new Map();

  // Playback state
  private _isPlaying = false;
  private _startContextTime = 0;
  private _startOffset = 0;
  private _originalDuration = 0; // duration of the original unedited audio
  private _duration = 0; // duration of the edited timeline (or original if no edits)
  private _operations: StemOperation[] = [];
  private _playGeneration = 0;

  // Edit timeline
  private _editTimeline: AudioRegion[] | null = null; // null = no edits (use original)
  private _timelineSources: AudioBufferSourceNode[] = []; // sources for timeline playback

  // Tempo state
  private _tempoRatio = 1;
  private _masterTempo = false;

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
  get originalDuration(): number {
    return this._originalDuration;
  }
  get isPlaying(): boolean {
    return this._isPlaying;
  }
  get currentTime(): number {
    if (!this._isPlaying) return this._startOffset;

    // In Master Tempo mode with no edit timeline, use the audio element's currentTime
    if (this._masterTempo && !this._editTimeline) {
      const el = this._getActiveElement();
      if (el) return Math.min(el.currentTime, this._duration);
    }

    // Buffer mode: account for tempo ratio
    const elapsed = this.ctx.currentTime - this._startContextTime;
    return Math.min(
      this._startOffset + elapsed * this._tempoRatio,
      this._duration
    );
  }
  get hasStemsLoaded(): boolean {
    return this.stems.size > 0;
  }
  get tempoRatio(): number {
    return this._tempoRatio;
  }
  get masterTempo(): boolean {
    return this._masterTempo;
  }
  get editTimeline(): AudioRegion[] | null {
    return this._editTimeline;
  }
  get stemNames(): string[] {
    return [...this.stems.keys()];
  }

  private _getActiveElement(): HTMLAudioElement | null {
    if (this._playbackMode === "stems") {
      for (const [name, el] of this.stemAudioElements) {
        if (name !== "instrumental") return el;
      }
    }
    return this.originalAudioElement;
  }

  // ── Loading ──────────────────────────────────────────────────────────

  async loadOriginal(url: string): Promise<void> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    this.originalBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this._originalDuration = this.originalBuffer.duration;
    this._duration = this.originalBuffer.duration;
    this._playbackMode = "original";

    // Create audio element for Master Tempo mode (non-blocking)
    this.originalAudioElement = new Audio(url);
    this.originalAudioElement.preload = "auto";
    this.originalElementSource = this.ctx.createMediaElementSource(this.originalAudioElement);
    this.originalElementSource.connect(this.masterGain);
    this.originalAudioElement.load();
  }

  async loadStem(name: string, url: string): Promise<void> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();

    const forBlob = arrayBuffer.slice(0);
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

    const gain = this.ctx.createGain();
    gain.connect(this.masterGain);

    if (name === "instrumental") {
      gain.gain.value = 0;
    }

    this.stems.set(name, { buffer: audioBuffer, gain });

    // Create Audio element for synced playback (non-blocking)
    const blob = new Blob([forBlob], { type: "audio/wav" });
    const blobUrl = URL.createObjectURL(blob);
    const audio = new Audio(blobUrl);
    audio.preload = "auto";
    const elementSource = this.ctx.createMediaElementSource(audio);
    elementSource.connect(gain);
    this.stemAudioElements.set(name, audio);
    this.stemElementSources.set(name, elementSource);
    audio.load();

    this._originalDuration = Math.max(this._originalDuration, audioBuffer.duration);
    if (!this._editTimeline) {
      this._duration = this._originalDuration;
    }
    this._playbackMode = "stems";
  }

  // ── Edit Timeline ────────────────────────────────────────────────────

  setEditTimeline(timeline: AudioRegion[] | null): void {
    const wasPlaying = this._isPlaying;
    const pos = this.currentTime;
    if (wasPlaying) this._stop();

    this._editTimeline = timeline;
    if (timeline) {
      this._duration = timeline.reduce((sum, r) => sum + (r.sourceEnd - r.sourceStart), 0);
    } else {
      this._duration = this._originalDuration;
    }

    this._startOffset = Math.min(pos, this._duration);
    if (wasPlaying) this.play();
    this._onTimeUpdate?.(this._startOffset);
  }

  mapEditedToSource(editedTime: number): { sourceTime: number; regionIndex: number } | null {
    if (!this._editTimeline) return { sourceTime: editedTime, regionIndex: 0 };
    let elapsed = 0;
    for (let i = 0; i < this._editTimeline.length; i++) {
      const region = this._editTimeline[i]!;
      const regionDur = region.sourceEnd - region.sourceStart;
      if (editedTime < elapsed + regionDur) {
        return { sourceTime: region.sourceStart + (editedTime - elapsed), regionIndex: i };
      }
      elapsed += regionDur;
    }
    return null;
  }

  getEditedPeaks(originalPeaks: Float32Array, numBuckets: number): Float32Array {
    if (!this._editTimeline || this._originalDuration === 0) return originalPeaks;

    const result = new Float32Array(numBuckets);
    const totalDuration = this._duration;
    if (totalDuration === 0) return result;
    const origBuckets = originalPeaks.length;

    let editOffset = 0;
    for (const region of this._editTimeline) {
      const regionDur = region.sourceEnd - region.sourceStart;
      const regionStartBucket = Math.floor((editOffset / totalDuration) * numBuckets);
      const regionEndBucket = Math.floor(((editOffset + regionDur) / totalDuration) * numBuckets);

      for (let b = regionStartBucket; b < regionEndBucket && b < numBuckets; b++) {
        const t = (b - regionStartBucket) / Math.max(1, regionEndBucket - regionStartBucket);
        const sourceTime = region.sourceStart + t * regionDur;
        const srcBucket = Math.floor((sourceTime / this._originalDuration) * origBuckets);
        result[b] = originalPeaks[Math.min(srcBucket, origBuckets - 1)] ?? 0;
      }
      editOffset += regionDur;
    }
    return result;
  }

  getEditedStemPeaks(stemName: string, numBuckets: number): Float32Array {
    const stem = this.stems.get(stemName);
    if (!stem) return new Float32Array(numBuckets);
    const origPeaks = this._extractPeaks(stem.buffer, numBuckets);
    return this.getEditedPeaks(origPeaks, numBuckets);
  }

  // ── Playback ─────────────────────────────────────────────────────────

  play(offset?: number): void {
    if (this._isPlaying) this._stop();

    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    this._playGeneration++;
    const startFrom = offset ?? this._startOffset;
    this._startOffset = startFrom;
    this._startContextTime = this.ctx.currentTime;

    if (this._editTimeline) {
      this._playTimeline(startFrom);
    } else if (this._playbackMode === "stems" && this.stems.size > 0) {
      if (this._masterTempo) {
        this._playStemsWithElements(startFrom);
      } else {
        this._playStems(startFrom);
      }
    } else if (this.originalBuffer) {
      if (this._masterTempo) {
        this._playOriginalWithElement(startFrom);
      } else {
        this._playOriginal(startFrom);
      }
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

  // ── Tempo control ────────────────────────────────────────────────────

  setTempoRatio(ratio: number): void {
    if (this._isPlaying) {
      const pos = this.currentTime;
      this._startOffset = pos;
      this._startContextTime = this.ctx.currentTime;
    }

    this._tempoRatio = ratio;

    if (this._isPlaying) {
      if (this._editTimeline) {
        const pos = this._startOffset;
        this._stopSources();
        this._startContextTime = this.ctx.currentTime;
        this._playTimeline(pos);
      } else if (this._masterTempo) {
        for (const audio of this.stemAudioElements.values()) {
          audio.playbackRate = ratio;
          audio.preservesPitch = true;
        }
        if (this.originalAudioElement) {
          this.originalAudioElement.playbackRate = ratio;
          this.originalAudioElement.preservesPitch = true;
        }
      } else {
        for (const source of this.stemSources.values()) {
          source.playbackRate.value = ratio;
        }
        if (this.originalSource) {
          this.originalSource.playbackRate.value = ratio;
        }
      }

      if (this._playbackMode === "stems" && !this._editTimeline) {
        this._scheduleAllGains();
      }
    }
  }

  setMasterTempo(enabled: boolean): void {
    if (this._masterTempo === enabled) return;
    const wasPlaying = this._isPlaying;
    const pos = this.currentTime;
    if (wasPlaying) this._stop();
    this._masterTempo = enabled;
    if (wasPlaying) this.play(pos);
  }

  // ── Operations ───────────────────────────────────────────────────────

  applyOperations(operations: StemOperation[]): void {
    this._operations = operations;
    if (this._isPlaying) {
      if (this._editTimeline) {
        // Restart timeline playback to reschedule gains
        const pos = this.currentTime;
        this._stopSources();
        this._startContextTime = this.ctx.currentTime;
        this._startOffset = pos;
        this._playTimeline(pos);
      } else if (this._playbackMode === "stems") {
        this._scheduleAllGains();
      }
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
    for (const audio of this.stemAudioElements.values()) {
      URL.revokeObjectURL(audio.src);
    }
    this.stemAudioElements.clear();
    this.stemElementSources.clear();
    this.originalAudioElement = null;
    this.originalElementSource = null;
    this.ctx.close();
  }

  // ── Private: Timeline Playback ───────────────────────────────────────

  private _playTimeline(startFrom: number): void {
    if (!this._editTimeline) return;
    const gen = this._playGeneration;
    const rate = this._tempoRatio;
    const contextNow = this.ctx.currentTime;

    // Find which region the startFrom falls in
    let editOffset = 0;
    let startRegionIdx = 0;
    for (let i = 0; i < this._editTimeline.length; i++) {
      const region = this._editTimeline[i]!;
      const regionDur = region.sourceEnd - region.sourceStart;
      if (startFrom < editOffset + regionDur) {
        startRegionIdx = i;
        break;
      }
      editOffset += regionDur;
      if (i === this._editTimeline.length - 1) startRegionIdx = i;
    }

    // Schedule buffer sources for each region from the start point
    let contextOffset = contextNow;
    let timeOffset = editOffset;

    for (let i = startRegionIdx; i < this._editTimeline.length; i++) {
      const region = this._editTimeline[i]!;
      const regionDur = region.sourceEnd - region.sourceStart;
      const skipInRegion = i === startRegionIdx ? (startFrom - timeOffset) : 0;
      const playDuration = regionDur - skipInRegion;

      if (playDuration <= 0) {
        timeOffset += regionDur;
        continue;
      }

      const regionContextStart = contextOffset;

      if (this._playbackMode === "stems" && this.stems.size > 0) {
        for (const [name, { buffer, gain }] of this.stems) {
          if (name === "instrumental") continue;
          const source = this.ctx.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.value = rate;
          source.connect(gain);
          source.start(regionContextStart, region.sourceStart + skipInRegion, playDuration);
          this._timelineSources.push(source);
        }
        // Schedule gains for each stem across this region
        for (const [name, { gain }] of this.stems) {
          if (name === "instrumental") continue;
          this._scheduleGainsForRegion(name, gain, skipInRegion, playDuration, regionContextStart, timeOffset + skipInRegion);
        }
      } else if (this.originalBuffer) {
        const source = this.ctx.createBufferSource();
        source.buffer = this.originalBuffer;
        source.playbackRate.value = rate;
        source.connect(this.masterGain);
        source.start(regionContextStart, region.sourceStart + skipInRegion, playDuration);
        this._timelineSources.push(source);
      }

      contextOffset += playDuration / rate;
      timeOffset += regionDur;
    }

    // Detect end
    const totalRemaining = this._duration - startFrom;
    const endContextTime = contextNow + totalRemaining / rate;
    const endTimer = setTimeout(() => {
      if (this._playGeneration === gen && this._isPlaying) {
        this._handleEnded();
      }
    }, (endContextTime - contextNow) * 1000 + 100);
    // Store the timer so we can clear it on stop (using generation check is enough)
    void endTimer;
  }

  private _scheduleGainsForRegion(
    stemName: string,
    gainNode: GainNode,
    _skipInRegion: number,
    playDuration: number,
    regionContextStart: number,
    editTimeStart: number,
  ): void {
    const rate = this._tempoRatio;
    const gainParam = gainNode.gain;

    const startGain = this._computeGainAtTime(stemName, editTimeStart);
    gainParam.setValueAtTime(startGain, regionContextStart);

    const editTimeEnd = editTimeStart + playDuration;
    for (const op of this._operations) {
      const opStart = op.time_range.start;
      const opEnd = op.time_range.end;

      if (opStart > editTimeStart && opStart < editTimeEnd) {
        const contextTime = regionContextStart + (opStart - editTimeStart) / rate;
        gainParam.setValueAtTime(this._computeGainAtTime(stemName, opStart), contextTime);
      }
      if (opEnd > editTimeStart && opEnd < editTimeEnd) {
        const contextTime = regionContextStart + (opEnd - editTimeStart) / rate;
        gainParam.setValueAtTime(this._computeGainAtTime(stemName, opEnd), contextTime);
      }
    }
  }

  // ── Private: Linear Playback ─────────────────────────────────────────

  private _playOriginal(offset: number): void {
    const gen = this._playGeneration;
    const source = this.ctx.createBufferSource();
    source.buffer = this.originalBuffer!;
    source.playbackRate.value = this._tempoRatio;
    source.connect(this.masterGain);
    source.start(0, offset);
    source.onended = () => {
      if (this._playGeneration === gen) this._handleEnded();
    };
    this.originalSource = source;
  }

  private _playOriginalWithElement(offset: number): void {
    if (!this.originalAudioElement) return;
    const gen = this._playGeneration;
    const audio = this.originalAudioElement;
    audio.currentTime = offset;
    audio.playbackRate = this._tempoRatio;
    audio.preservesPitch = true;
    audio.play().catch(() => {});
    audio.onended = () => {
      if (this._playGeneration === gen) this._handleEnded();
    };
  }

  private _playStems(offset: number): void {
    const gen = this._playGeneration;
    for (const [name, { buffer, gain }] of this.stems) {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = this._tempoRatio;
      source.connect(gain);
      source.start(0, offset);
      this.stemSources.set(name, source);
    }

    this._scheduleAllGains();

    const firstSource = this.stemSources.values().next().value;
    if (firstSource) {
      firstSource.onended = () => {
        if (this._playGeneration === gen) this._handleEnded();
      };
    }
  }

  private _playStemsWithElements(offset: number): void {
    const gen = this._playGeneration;
    let firstAudio: HTMLAudioElement | null = null;

    for (const [name, audio] of this.stemAudioElements) {
      audio.currentTime = offset;
      audio.playbackRate = this._tempoRatio;
      audio.preservesPitch = true;
      audio.play().catch(() => {});
      if (!firstAudio && name !== "instrumental") firstAudio = audio;
    }

    if (firstAudio) {
      firstAudio.onended = () => {
        if (this._playGeneration === gen) this._handleEnded();
      };
    }

    this._scheduleAllGains();
  }

  // ── Private: Stop ────────────────────────────────────────────────────

  private _stopSources(): void {
    for (const src of this._timelineSources) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this._timelineSources = [];

    if (this.originalSource) {
      this.originalSource.onended = null;
      try { this.originalSource.stop(); } catch { /* */ }
      this.originalSource = null;
    }
    for (const source of this.stemSources.values()) {
      source.onended = null;
      try { source.stop(); } catch { /* */ }
    }
    this.stemSources.clear();

    for (const audio of this.stemAudioElements.values()) {
      audio.pause();
      audio.onended = null;
    }
    if (this.originalAudioElement) {
      this.originalAudioElement.pause();
      this.originalAudioElement.onended = null;
    }
  }

  private _stop(): void {
    this._stopSources();
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

  // ── Gain scheduling (linear playback) ────────────────────────────────

  private _scheduleAllGains(): void {
    const contextNow = this.ctx.currentTime;
    const audioNow = this.currentTime;
    const rate = this._tempoRatio;

    for (const [name, { gain }] of this.stems) {
      if (name === "instrumental") continue;

      const gainParam = gain.gain;
      gainParam.cancelScheduledValues(0);

      const currentGain = this._computeGainAtTime(name, audioNow);
      gainParam.setValueAtTime(currentGain, contextNow);

      const timeline = this._computeGainTimeline(name);
      for (const { time, gain: g } of timeline) {
        if (time > audioNow) {
          const contextTime = contextNow + (time - audioNow) / rate;
          gainParam.setValueAtTime(g, contextTime);
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

    const activeOps = this._operations.filter(
      (op) => time >= op.time_range.start && time < op.time_range.end
    );

    if (activeOps.length === 0) return 1;

    for (const op of activeOps) {
      if (op.action === "remove") {
        if (op.stem === stemName) return 0;
        if (op.stem === "instrumental" && stemName !== "vocals") return 0;
      }
    }

    const isolateOps = activeOps.filter((op) => op.action === "isolate");
    if (isolateOps.length > 0) {
      const isolatedStems = new Set<string>();
      for (const op of isolateOps) {
        if (op.stem === "instrumental") {
          isolatedStems.add("drums");
          isolatedStems.add("bass");
          isolatedStems.add("guitar");
          isolatedStems.add("piano");
          isolatedStems.add("other");
        } else {
          isolatedStems.add(op.stem);
        }
      }
      return isolatedStems.has(stemName) ? 1 : 0;
    }

    return 1;
  }

  // ── Peaks ────────────────────────────────────────────────────────────

  private _extractPeaks(
    buffer: AudioBuffer,
    numBuckets: number
  ): Float32Array {
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
        if (max > (peaks[i] ?? 0)) peaks[i] = max;
      }
    }

    return peaks;
  }
}
