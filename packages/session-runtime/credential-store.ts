export class CredentialInterrupted extends Error {
  constructor() { super('AUTH_INTERRUPTED'); }
}

/** Serializes platform key-store mutations across background/auth transitions. */
export class CredentialStore {
  private writes: Promise<unknown> = Promise.resolve();
  private port: { set(value: string): Promise<void>; remove(): Promise<void> };
  constructor(port: { set(value: string): Promise<void>; remove(): Promise<void> }) { this.port = port; }
  update(value: string | null, current: () => boolean = () => true) {
    const operation = this.writes.then(async () => {
      if (!current()) throw new CredentialInterrupted();
      if (value === null) await this.port.remove(); else await this.port.set(value);
      if (!current()) {
        // The next credential cannot be written until this cleanup completes.
        if (value !== null) await this.port.remove();
        throw new CredentialInterrupted();
      }
    });
    this.writes = operation.catch(() => undefined); return operation;
  }
}
