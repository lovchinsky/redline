/**
 * Runs async tasks one at a time, in the order they were queued. A failed task does not
 * stop the queue; its caller still observes the rejection.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
