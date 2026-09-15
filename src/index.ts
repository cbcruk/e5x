/**
 * Shape-matched, reactive access to DOM trees: the data's structure is the access path.
 *
 * {@linkcode wrap} returns a proxy whose properties follow the markup — child elements and
 * attributes by name. Collections, columns, and fields are atoms, so the same path reads,
 * writes, and subscribes. {@linkcode computed} derives atoms from atoms.
 *
 * @example Read, write, subscribe
 * ```ts
 * import { wrap } from 'e5x'
 *
 * document.body.innerHTML = `
 *   <sales vendor="John">
 *     <item type="carrot" price="3" quantity="10"></item>
 *     <item type="peas" price="4" quantity="6"></item>
 *   </sales>`
 *
 * const sales = wrap(document.querySelector('sales')!, {
 *   vendor: 'string',
 *   item: [{ type: 'string', price: 'number', quantity: 'number' }],
 * } as const)
 *
 * const carrotPrice = sales.item.$where({ type: 'carrot' })[0]?.price
 * sales.item.$push({ type: 'oranges', price: 4, quantity: 12 })
 * sales.item.price.$sum.subscribe((total) => console.log(total, carrotPrice))
 * ```
 *
 * @module
 */
export { wrap } from './wrap'
export { computed } from './computed'
export type {
  Wrapped,
  Collection,
  Column,
  NodeDescriptor,
  FieldDescriptor,
  LeafDescriptor,
  LeafType,
  Deps,
  SortDirection,
  ReservedName,
  ValidDescriptor,
  Predicate,
  WritableFields,
  ReadableAtom,
  LooseWrapped,
  LooseCollection,
} from './types'
