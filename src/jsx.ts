type Child = Node | string | number | boolean | null | undefined | Child[];

function appendChildren(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) {
      continue;
    }
    if (Array.isArray(child)) {
      appendChildren(parent, child);
    } else if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}

type Component = (props: Record<string, unknown> | null, ...children: Child[]) => Node;

export function h(
  tag: string | Component,
  props: Record<string, unknown> | null,
  ...children: Child[]
): Node {
  if (typeof tag === 'function') {
    return tag(props, ...children);
  }
  const element = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      element.setAttribute(key, String(value));
    }
  }
  appendChildren(element, children);
  return element;
}

export function Fragment(
  _props: Record<string, unknown> | null,
  ...children: Child[]
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  appendChildren(fragment, children);
  return fragment;
}

declare global {
  namespace JSX {
    type Element = HTMLElement;
    interface IntrinsicElements {
      [tag: string]: Record<string, string | number | boolean>;
    }
  }
}
