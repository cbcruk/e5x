import type { ReadableAtom } from './types';

type Listener = (records: MutationRecord[]) => void;

const listeners = new Set<Listener>();
const observedNodes = new WeakSet<Node>();
let observer: MutationObserver | null = null;

function notify(records: MutationRecord[]): void {
  for (const listener of [...listeners]) {
    listener(records);
  }
}

// Observe the node itself rather than its document: a registration travels with the node,
// so detached trees, shadow roots, and trees later moved into the document all stay live.
function ensureObserving(node: Node): void {
  if (observedNodes.has(node)) {
    return;
  }
  if (!observer) {
    observer = new MutationObserver(notify);
  }
  observer.observe(node, { childList: true, subtree: true, attributes: true });
  observedNodes.add(node);
}

export function watch(node: Node, listener: Listener): () => void {
  ensureObserving(node);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function affects(node: Node, records: MutationRecord[]): boolean {
  for (const record of records) {
    const target = record.target;
    if (target === node || node.contains(target)) {
      return true;
    }
  }
  return false;
}

export function sameElements(a: Element[], b: Element[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((element, index) => element === b[index]);
}

export function derived<T>(
  node: Node,
  compute: () => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): ReadableAtom<T> {
  return {
    get: compute,
    subscribe(listener) {
      let previous = compute();
      listener(previous);
      return watch(node, (records) => {
        if (!affects(node, records)) {
          return;
        }
        const next = compute();
        if (!isEqual(next, previous)) {
          previous = next;
          listener(next);
        }
      });
    },
  };
}
