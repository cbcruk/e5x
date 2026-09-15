/**
 * XML-literal authoring: a classic-runtime JSX factory that builds real DOM elements.
 *
 * Compile with the classic JSX runtime and `h` / `Fragment` as factories — for TypeScript,
 * `"jsx": "react"`, `"jsxFactory": "h"`, `"jsxFragmentFactory": "Fragment"` — and pass the
 * result to `wrap`. Importing this entry declares a global `JSX` namespace, which conflicts with
 * React's, and `h` needs a global `document`.
 *
 * @example Author a tree for wrap
 * ```tsx
 * import { wrap } from 'e5x'
 * import { h } from 'e5x/jsx'
 *
 * const sales = wrap(
 *   (
 *     <sales vendor="John">
 *       <item type="peas" price="4" />
 *     </sales>
 *   ) as Element,
 *   { vendor: 'string', item: [{ type: 'string', price: 'number' }] } as const,
 * )
 * const total = sales.item.price.$sum.get()
 * ```
 *
 * @module
 */
type Child = Node | string | number | boolean | null | undefined | Child[]

function appendChildren(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) {
      continue
    }
    if (Array.isArray(child)) {
      appendChildren(parent, child)
    } else if (child instanceof Node) {
      parent.appendChild(child)
    } else {
      parent.appendChild(document.createTextNode(String(child)))
    }
  }
}

type Component = (props: Record<string, unknown> | null, ...children: Child[]) => Node

/**
 * Creates the DOM element for a JSX expression, or calls the component it names.
 *
 * Props become attributes through `String(value)`. Children are appended in order: arrays are
 * flattened, and `null`, `undefined`, `true`, and `false` are skipped.
 *
 * @param tag An element name, or a component called with the props and children.
 */
export function h(
  tag: string | Component,
  props: Record<string, unknown> | null,
  ...children: Child[]
): Node {
  if (typeof tag === 'function') {
    return tag(props, ...children)
  }
  const element = document.createElement(tag)
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      element.setAttribute(key, String(value))
    }
  }
  appendChildren(element, children)
  return element
}

/** Collects JSX children into a `DocumentFragment` for `<>…</>` expressions. */
export function Fragment(
  _props: Record<string, unknown> | null,
  ...children: Child[]
): DocumentFragment {
  const fragment = document.createDocumentFragment()
  appendChildren(fragment, children)
  return fragment
}

declare global {
  /** JSX types for the {@linkcode h} factory. */
  namespace JSX {
    /** The value of a JSX element expression. */
    type Element = HTMLElement
    /** Any tag name is allowed; attribute values are stringified. */
    interface IntrinsicElements {
      /** Attributes of an element with this tag name. */
      [tag: string]: Record<string, string | number | boolean>
    }
  }
}
