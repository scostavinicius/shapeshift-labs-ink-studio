// The sort, off the main thread. The worker keeps its own copy of the splats, kept up to date by the same rows the
// graphics card is sent, so a sort costs the page nothing but the message. See sorter.ts for the other end.
import { makeScratch, sortSplats, type OrderScratch } from './order';

export type ToWorker =
  | { type: 'init'; data: Float32Array; count: number; back: Int32Array | null }
  /** rows[i] is a row of 512 splats; its floats are chunk[i * rowFloats ..] */
  | { type: 'rows'; rows: Int32Array; chunk: Float32Array; rowFloats: number }
  | { type: 'sort'; id: number; t: number; V: Float64Array; bones: Float32Array | null };

export type FromWorker = { type: 'order'; id: number; order: Uint32Array; ms: number };

let data: Float32Array = new Float32Array(0),
  count = 0,
  back: Int32Array | null = null,
  scratch: OrderScratch | null = null;

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(m: FromWorker, transfer: Transferable[]): void;
};

scope.onmessage = e => {
  const m = e.data;
  if (m.type === 'init') {
    data = m.data;
    count = m.count;
    back = m.back;
    scratch = makeScratch(count);
  } else if (m.type === 'rows') {
    for (let i = 0; i < m.rows.length; i++)
      data.set(m.chunk.subarray(i * m.rowFloats, (i + 1) * m.rowFloats), m.rows[i] * m.rowFloats);
  } else if (m.type === 'sort' && scratch) {
    const t0 = performance.now(),
      order = sortSplats({ data, count, back }, { t: m.t, V: m.V }, scratch, m.bones).slice();
    scope.postMessage({ type: 'order', id: m.id, order, ms: performance.now() - t0 }, [order.buffer]);
  }
};
