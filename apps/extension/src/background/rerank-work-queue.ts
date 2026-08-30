export const MAX_PENDING_RERANK_WORK = 8;
export const MAX_RERANK_QUEUE_WAIT_MS = 5_000;

export type RerankQueueSkipReason = "capacity" | "deadline" | "superseded";

export class RerankQueueCapacityError extends Error {
  readonly queueWaitMs: number;

  constructor(queueWaitMs = 0) {
    super("Pending rerank work was dropped to keep the queue bounded");
    this.name = "RerankQueueCapacityError";
    this.queueWaitMs = queueWaitMs;
  }
}

export class RerankSupersededError extends Error {
  readonly queueWaitMs: number;

  constructor(queueWaitMs = 0) {
    super("Pending rerank work was superseded by a newer request");
    this.name = "RerankSupersededError";
    this.queueWaitMs = queueWaitMs;
  }
}

export class RerankQueueDeadlineError extends Error {
  readonly queueWaitMs: number;

  constructor(queueWaitMs = 0) {
    super("Pending rerank work expired before inference could start");
    this.name = "RerankQueueDeadlineError";
    this.queueWaitMs = queueWaitMs;
  }
}

export function getRerankQueueSkipDetails(error: unknown): {
  reason: RerankQueueSkipReason;
  queueWaitMs: number;
} | null {
  if (error instanceof RerankQueueCapacityError) {
    return { reason: "capacity", queueWaitMs: error.queueWaitMs };
  }
  if (error instanceof RerankSupersededError) {
    return { reason: "superseded", queueWaitMs: error.queueWaitMs };
  }
  if (error instanceof RerankQueueDeadlineError) {
    return { reason: "deadline", queueWaitMs: error.queueWaitMs };
  }
  return null;
}

interface PendingRerankWork {
  requestKey: string | undefined;
  queuedAt: number;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export function createRerankWorkQueue(
  options: { maximumPending?: number; maximumQueueWaitMs?: number } = {}
) {
  const maximumPending = options.maximumPending ?? MAX_PENDING_RERANK_WORK;
  const maximumQueueWaitMs =
    options.maximumQueueWaitMs ?? MAX_RERANK_QUEUE_WAIT_MS;
  if (!Number.isInteger(maximumPending) || maximumPending < 1) {
    throw new RangeError("maximumPending must be a positive integer");
  }
  if (!Number.isFinite(maximumQueueWaitMs) || maximumQueueWaitMs < 0) {
    throw new RangeError("maximumQueueWaitMs must be a non-negative number");
  }

  let running = false;
  let pending: PendingRerankWork[] = [];

  const rejectSupersededWork = (requestKey: string | undefined): void => {
    if (!requestKey) return;

    const retained: PendingRerankWork[] = [];
    for (const work of pending) {
      if (work.requestKey === requestKey) {
        work.reject(new RerankSupersededError(Date.now() - work.queuedAt));
      } else {
        retained.push(work);
      }
    }
    pending = retained;
  };

  const startNext = (): void => {
    if (running) return;

    let next = pending.shift();
    while (next) {
      const queueWaitMs = Date.now() - next.queuedAt;
      if (queueWaitMs <= maximumQueueWaitMs) break;
      next.reject(new RerankQueueDeadlineError(queueWaitMs));
      next = pending.shift();
    }
    if (!next) return;

    running = true;
    void (async () => {
      try {
        next.resolve(await next.run());
      } catch (error) {
        next.reject(error);
      } finally {
        running = false;
        startNext();
      }
    })();
  };

  return {
    enqueue<T>(
      requestKey: string | undefined,
      run: () => Promise<T>
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        rejectSupersededWork(requestKey);

        if (pending.length >= maximumPending) {
          const oldest = pending.shift();
          if (oldest) {
            oldest.reject(
              new RerankQueueCapacityError(Date.now() - oldest.queuedAt)
            );
          }
        }

        pending.push({
          requestKey,
          queuedAt: Date.now(),
          run,
          resolve: (value) => resolve(value as T),
          reject,
        });
        startNext();
      });
    },

    snapshot(): { pending: number; running: boolean } {
      return { pending: pending.length, running };
    },
  };
}
