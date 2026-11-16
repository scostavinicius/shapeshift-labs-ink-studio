// The page's end of the sort worker. The renderer tells it what it tells the graphics card (everything once, then the
// rows that changed); each frame it is asked for an order for the current view, and hands back the newest it has. An
// order is therefore a frame or two old when it is used: splats move little in that time, and a wrong order between two
// splats shows only where they overlap and differ. Anything that must be exact (the parity harness) sorts in step instead.
import type { FromWorker, ToWorker } from './sort-worker';

export class WorkerSorter {
  private worker: Worker;
  private busy = false;
  private nextId = 1;
  private waiting = new Map<number, (order: Uint32Array) => void>();
  /** the newest order, and the splat count it was made for (null until the first arrives) */
  order: Uint32Array | null = null;
  /** counts up each time a new order arrives, so a renderer knows when to send it to the graphics card */
  version = 0;
  /** how long the worker took over its last sort, in milliseconds */
  ms = 0;

  constructor(url: string) {
    this.worker = new Worker(url, { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      this.busy = false;
      this.order = m.order;
      this.version++;
      this.ms = m.ms;
      const done = this.waiting.get(m.id);
      if (done) {
        this.waiting.delete(m.id);
        done(m.order);
      }
    };
  }

  private post(m: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(m, transfer);
  }

  /** Everything: `padded` is the renderer's own mirror of the data texture (whole rows of 512 splats). It is copied. */
  init(padded: Float32Array, count: number, back: Int32Array | null | undefined): void {
    const data = padded.slice();
    this.order = null;
    this.post({ type: 'init', data, count, back: back ? back.slice() : null }, [data.buffer]);
  }

  /** The rows that changed, read from the same mirror. */
  rows(list: number[], padded: Float32Array, rowFloats: number): void {
    if (!list.length) return;
    const chunk = new Float32Array(list.length * rowFloats);
    for (let i = 0; i < list.length; i++) chunk.set(padded.subarray(list[i] * rowFloats, (list[i] + 1) * rowFloats), i * rowFloats);
    this.post({ type: 'rows', rows: Int32Array.from(list), chunk, rowFloats }, [chunk.buffer]);
  }

  private send(t: number, V: ArrayLike<number>, bones: ArrayLike<number> | null | undefined): number {
    const id = this.nextId++;
    this.busy = true;
    // (the view matrix goes as doubles: the page sorts with doubles, and a float32 copy would order near-ties differently)
    this.post({ type: 'sort', id, t, V: Float64Array.from(V), bones: bones ? Float32Array.from(bones) : null });
    return id;
  }

  /** Ask for an order for this view, unless the worker is still on the last one. */
  request(t: number, V: ArrayLike<number>, bones: ArrayLike<number> | null | undefined): void {
    if (!this.busy) this.send(t, V, bones);
  }

  /** An order for exactly this view and the data sent so far: resolves when the worker has made it. For checks. */
  exact(t: number, V: ArrayLike<number>, bones: ArrayLike<number> | null | undefined): Promise<Uint32Array> {
    return new Promise(done => this.waiting.set(this.send(t, V, bones), done));
  }

  dispose(): void {
    this.worker.terminate();
  }
}
