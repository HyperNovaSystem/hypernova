import type { EventToken, EventAccessor } from './types.js';

/**
 * Define a typed event token.
 */
export function defineEvent<T>(name: string): EventToken<T> {
  return { name } as EventToken<T>;
}

/**
 * Double-buffered event storage.
 *
 * Events emitted in one stage become readable in the next stage.
 * At frame boundary, all buffers are cleared.
 */
export class EventStore implements EventAccessor {
  /** Events written this stage (pending) */
  private writeBuffers = new Map<string, unknown[]>();

  /** Events readable this stage (committed from previous stage) */
  private readBuffers = new Map<string, unknown[]>();

  emit<T>(token: EventToken<T>, data: T): void {
    let buf = this.writeBuffers.get(token.name);
    if (!buf) {
      buf = [];
      this.writeBuffers.set(token.name, buf);
    }
    buf.push(data);
  }

  read<T>(token: EventToken<T>): readonly T[] {
    return (this.readBuffers.get(token.name) as T[]) ?? [];
  }

  /**
   * Flush write buffer into read buffer (called between stages).
   * Events from the write buffer are appended to the read buffer,
   * then the write buffer is cleared.
   */
  flushStage(): void {
    for (const [name, events] of this.writeBuffers) {
      let readBuf = this.readBuffers.get(name);
      if (!readBuf) {
        readBuf = [];
        this.readBuffers.set(name, readBuf);
      }
      for (const e of events) {
        readBuf.push(e);
      }
      events.length = 0;
    }
  }

  /**
   * Clear all buffers (called at frame boundary).
   */
  clearFrame(): void {
    for (const buf of this.writeBuffers.values()) buf.length = 0;
    for (const buf of this.readBuffers.values()) buf.length = 0;
  }

  clear(): void {
    this.writeBuffers.clear();
    this.readBuffers.clear();
  }
}
