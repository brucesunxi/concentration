/** Keeps all operations on a single keyed database connection in one order. */
export class SerialQueue {
  private pending: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }
}
