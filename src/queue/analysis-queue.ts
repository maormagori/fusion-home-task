import PQueue from 'p-queue';

export interface AnalysisQueue {
  enqueue(feedbackId: string): void;
  onIdle(): Promise<void>;
}

export function createAnalysisQueue(
  concurrency: number,
  process: (feedbackId: string) => Promise<void>,
): AnalysisQueue {
  const queue = new PQueue({ concurrency });

  return {
    enqueue(feedbackId: string): void {
      void queue.add(() => runJob(feedbackId, process));
    },
    onIdle(): Promise<void> {
      return queue.onIdle();
    },
  };
}

// Nobody awaits a queued job, so an error that escaped here would become an unhandled rejection.
async function runJob(feedbackId: string, process: (feedbackId: string) => Promise<void>): Promise<void> {
  try {
    await process(feedbackId);
  } catch (error) {
    console.error(`Analysis job failed for feedback ${feedbackId}:`, error);
  }
}
