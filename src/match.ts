import { wrapNode } from './wrap';
import { readRaw, isLeaf, fromDom } from './coerce';
import type { LooseWrapped, NodeDescriptor } from './types';

export function matches(
  element: Element,
  predicate: Record<string, unknown> | ((element: LooseWrapped) => boolean),
  descriptor: NodeDescriptor | null,
): boolean {
  if (typeof predicate === 'function') {
    return predicate(wrapNode(element, descriptor));
  }
  return Object.entries(predicate).every(([key, value]) => {
    const raw = readRaw(element, key);
    const field = descriptor?.[key];
    if (isLeaf(field)) {
      return fromDom(raw, field) === value;
    }
    return raw === String(value);
  });
}
