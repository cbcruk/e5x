import type { ReadableAtom } from './types';

type Listener = () => void;

const listeners = new Set<Listener>();
// Every observed node carries a version that bumps whenever a mutation lands in its subtree.
// Memoized reads compare versions; subscribers skip work when their node's version is unchanged.
const versions = new WeakMap<Node, number>();
let observer: MutationObserver | null = null;
let notifyScheduled = false;

function notify(): void {
  notifyScheduled = false;
  for (const listener of [...listeners]) {
    listener();
  }
}

function ingest(records: MutationRecord[]): void {
  const bumped = new Set<Node>();
  for (const record of records) {
    for (let node: Node | null = record.target; node; node = node.parentNode) {
      if (bumped.has(node)) {
        break;
      }
      const version = versions.get(node);
      if (version !== undefined) {
        versions.set(node, version + 1);
      }
      bumped.add(node);
    }
  }
  if (!notifyScheduled && listeners.size > 0) {
    notifyScheduled = true;
    queueMicrotask(notify);
  }
}

// Observe the node itself rather than its document: a registration travels with the node,
// so detached trees, shadow roots, and trees later moved into the document all stay live.
function ensureObserving(node: Node): void {
  if (versions.has(node)) {
    return;
  }
  if (!observer) {
    observer = new MutationObserver(ingest);
  }
  observer.observe(node, { childList: true, subtree: true, attributes: true, characterData: true });
  versions.set(node, 0);
}

// MutationObserver delivers asynchronously; pull pending records so a read right after a
// synchronous write never sees a stale cache.
function version(node: Node): number {
  ensureObserving(node);
  const pending = observer!.takeRecords();
  if (pending.length > 0) {
    ingest(pending);
  }
  return versions.get(node)!;
}

export function memo<T>(node: Node, compute: () => T): () => T {
  let cachedVersion = -1;
  let cached: T;
  return () => {
    const current = version(node);
    if (current !== cachedVersion) {
      cached = compute();
      cachedVersion = current;
    }
    return cached;
  };
}

export function watch(node: Node, listener: (version: number) => void): () => void {
  let seen = version(node);
  const onMutation = (): void => {
    const current = version(node);
    if (current !== seen) {
      seen = current;
      listener(current);
    }
  };
  listeners.add(onMutation);
  return () => {
    listeners.delete(onMutation);
  };
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
  const get = memo(node, compute);
  return {
    get,
    subscribe(listener) {
      let previous = get();
      listener(previous);
      return watch(node, () => {
        const next = get();
        if (!isEqual(next, previous)) {
          previous = next;
          listener(next);
        }
      });
    },
  };
}
