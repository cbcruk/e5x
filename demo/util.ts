import type { ReadableAtom } from '../src/index';

export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`demo: missing ${selector}`);
  }
  return element;
}

// A bag of unsubscribe functions for everything bound to one view.
export function scope(): { add(stop: () => void): void; reset(): void } {
  let stops: (() => void)[] = [];
  return {
    add: (stop) => stops.push(stop),
    reset: () => {
      stops.forEach((stop) => stop());
      stops = [];
    },
  };
}

export function bindText<T>(
  target: Element,
  atom: ReadableAtom<T>,
  format: (value: T) => string = String,
): () => void {
  return atom.subscribe((value) => {
    target.textContent = format(value);
  });
}

// e5x has no combinator across atoms (nanostores `computed` territory); this is the minimum
// the demo needs to derive revenue from two columns.
export function combine<A, B, R>(
  a: ReadableAtom<A>,
  b: ReadableAtom<B>,
  fn: (a: A, b: B) => R,
): ReadableAtom<R> {
  return {
    get: () => fn(a.get(), b.get()),
    subscribe(listener) {
      let ready = false;
      const emit = (): void => {
        if (ready) {
          listener(fn(a.get(), b.get()));
        }
      };
      const stops = [a.subscribe(emit), b.subscribe(emit)];
      ready = true;
      emit();
      return () => stops.forEach((stop) => stop());
    },
  };
}

export function serialize(element: Element, depth = 0): string {
  const pad = '  '.repeat(depth);
  const name = element.localName;
  const attrs = Array.from(element.attributes)
    .filter((attr) => attr.name !== 'hidden')
    .map((attr) => ` ${attr.name}="${attr.value}"`)
    .join('');
  const children = Array.from(element.children);
  if (children.length === 0) {
    const text = element.textContent?.trim();
    return text ? `${pad}<${name}${attrs}>${text}</${name}>` : `${pad}<${name}${attrs} />`;
  }
  return [
    `${pad}<${name}${attrs}>`,
    ...children.map((child) => serialize(child, depth + 1)),
    `${pad}</${name}>`,
  ].join('\n');
}

export const money = (n: number): string => (Number.isFinite(n) ? `$${n.toFixed(2)}` : '–');
