export interface TransactionEvent {
  op: string;
  key: string;
  status: string;
  duration: string;
  desc: string;
  timestamp: number; // epoch ms
}

class ActivityLogger {
  private queue: TransactionEvent[] = [];

  constructor() {
    // Populate with 2 initial structural check events
    this.queue.push({
      op: "SYSTEM",
      key: "Registry initialized",
      status: "Success",
      duration: "0.10ms",
      desc: "Storage engine node connection established",
      timestamp: Date.now() - 10000,
    });
  }

  public log(op: string, key: string, status: string, durationMs: number, desc: string) {
    const event: TransactionEvent = {
      op,
      key,
      status,
      duration: `${durationMs.toFixed(2)}ms`,
      desc,
      timestamp: Date.now(),
    };
    this.queue.unshift(event);
    
    // Cap size to last 50 transactions
    if (this.queue.length > 50) {
      this.queue.pop();
    }
  }

  public getStats() {
    const now = Date.now();
    const recent = this.queue.filter((x) => now - x.timestamp <= 5000);
    // Ops rate is operations in the last 5 seconds divided by 5
    const opsRate = Math.round((recent.length / 5) * 10) / 10;
    
    return {
      logs: this.queue.slice(0, 8), // return last 8 transactions
      opsRate: Math.max(opsRate, 0),
    };
  }
}

// Global persistence to survive hot reloading in Next.js development
const globalForActivity = globalThis as unknown as {
  activityLogger?: ActivityLogger;
};

export const activityLogger = globalForActivity.activityLogger ?? new ActivityLogger();

if (process.env.NODE_ENV !== "production") {
  globalForActivity.activityLogger = activityLogger;
}
