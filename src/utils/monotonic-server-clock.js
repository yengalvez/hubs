const DEFAULT_MAX_SLEW_MS_PER_SECOND = 50;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class MonotonicServerClock {
  constructor(maxSlewMsPerSecond = DEFAULT_MAX_SLEW_MS_PER_SECOND) {
    this.maxSlewMsPerSecond = Math.max(0, Number(maxSlewMsPerSecond) || 0);
    this.offsetMs = null;
    this.lastPerformanceNowMs = null;
    this.lastNowMs = null;
  }

  now(performanceNowMs, rawServerNowMs) {
    const perfNow = Number(performanceNowMs);
    const rawNow = Number(rawServerNowMs);

    if (!Number.isFinite(perfNow)) {
      return Number.isFinite(this.lastNowMs) ? this.lastNowMs : Number.isFinite(rawNow) ? rawNow : 0;
    }

    if (Number.isFinite(rawNow)) {
      const targetOffsetMs = rawNow - perfNow;

      if (!Number.isFinite(this.offsetMs)) {
        // The first sample must use the complete epoch offset. Starting at zero and smoothing
        // towards it makes bot paths fast-forward for newly connected clients.
        this.offsetMs = targetOffsetMs;
      } else {
        const elapsedPerformanceMs = Math.max(0, perfNow - (this.lastPerformanceNowMs ?? perfNow));
        const maxCorrectionMs = (this.maxSlewMsPerSecond * elapsedPerformanceMs) / 1000;
        const correctionMs = clamp(targetOffsetMs - this.offsetMs, -maxCorrectionMs, maxCorrectionMs);
        this.offsetMs += correctionMs;
      }
    } else if (!Number.isFinite(this.offsetMs)) {
      this.offsetMs = 0;
    }

    let nowMs = perfNow + this.offsetMs;
    if (Number.isFinite(this.lastNowMs) && nowMs < this.lastNowMs) nowMs = this.lastNowMs;

    this.lastPerformanceNowMs = perfNow;
    this.lastNowMs = nowMs;
    return nowMs;
  }
}
