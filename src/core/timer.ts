const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface ScheduledTimer {
  cancel(): void;
}

/** Schedule delays longer than the platform's signed 32-bit timer limit safely. */
export function scheduleTimer(callback: () => void, delayMs: number): ScheduledTimer {
  let remainingMs = delayMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const scheduleNext = () => {
    if (cancelled) return;
    const chunkMs = Math.min(remainingMs, MAX_TIMER_DELAY_MS);
    timer = setTimeout(() => {
      remainingMs -= chunkMs;
      if (remainingMs > 0) scheduleNext();
      else callback();
    }, chunkMs);
  };

  scheduleNext();
  return {
    cancel() {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
