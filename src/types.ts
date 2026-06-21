export interface ReadableAtom<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

export type LeafDescriptor = 'string' | 'number' | 'boolean';

export type FieldDescriptor = LeafDescriptor | readonly [NodeDescriptor];

export interface NodeDescriptor {
  readonly [key: string]: FieldDescriptor;
}

export type SortDirection = 'asc' | 'desc';

type LeafValue<F extends LeafDescriptor> = F extends 'string'
  ? string
  : F extends 'number'
    ? number
    : boolean;

type FieldValue<F> = F extends LeafDescriptor
  ? LeafValue<F>
  : F extends readonly [infer Child]
    ? Collection<Child>
    : never;

type ElementFields<N> = {
  -readonly [K in keyof N]: FieldValue<N[K]>;
};

type CollectionFields<N> = {
  -readonly [K in keyof N]: N[K] extends LeafDescriptor
    ? Column<LeafValue<N[K]>>
    : N[K] extends readonly [infer Child]
      ? Collection<Child>
      : never;
};

type LeafKeys<N> = {
  [K in keyof N]: N[K] extends LeafDescriptor ? K : never;
}[keyof N];

type SortKey<N> = LeafKeys<N> & string;

export type WritableFields<N> = Partial<{
  [K in LeafKeys<N>]: FieldValue<N[K]>;
}>;

export type Predicate<N> =
  | WritableFields<N>
  | ((element: Wrapped<N>) => boolean);

export interface WrappedBase {
  readonly $el: Element;
  readonly $attr: Record<string, string | null>;
  deep(name: string): LooseCollection;
}

export type Wrapped<N> = WrappedBase & ElementFields<N>;

export interface Column<T> {
  readonly length: number;
  readonly $length: ReadableAtom<number>;
  readonly $values: ReadableAtom<T[]>;
  readonly $sum: ReadableAtom<number>;
  readonly $avg: ReadableAtom<number>;
  readonly $min: ReadableAtom<T>;
  readonly $max: ReadableAtom<T>;
  get(): T[];
  subscribe(listener: (values: T[]) => void): () => void;
  readonly [index: number]: T;
  [Symbol.iterator](): Iterator<T>;
}

interface CollectionBase<N> {
  readonly length: number;
  readonly $length: ReadableAtom<number>;
  where(predicate: Predicate<N>): Collection<N>;
  sort(field: SortKey<N>, direction?: SortDirection): Collection<N>;
  sort(comparator: (a: Wrapped<N>, b: Wrapped<N>) => number): Collection<N>;
  deep(name: string): LooseCollection;
  push(data: WritableFields<N>): Wrapped<N>;
  get(): Wrapped<N>[];
  subscribe(listener: (value: Wrapped<N>[]) => void): () => void;
  readonly [index: number]: Wrapped<N>;
  [Symbol.iterator](): Iterator<Wrapped<N>>;
}

export type Collection<N> = CollectionBase<N> & CollectionFields<N>;

export interface LooseWrapped {
  readonly $el: Element;
  readonly $attr: Record<string, string | null>;
  deep(name: string): LooseCollection;
  [key: string]: any;
}

export interface LooseCollection {
  readonly length: number;
  readonly $length: ReadableAtom<number>;
  where(
    predicate: Record<string, unknown> | ((element: LooseWrapped) => boolean),
  ): LooseCollection;
  sort(
    field: string | ((a: LooseWrapped, b: LooseWrapped) => number),
    direction?: SortDirection,
  ): LooseCollection;
  deep(name: string): LooseCollection;
  push(data: Record<string, unknown>): LooseWrapped;
  get(): LooseWrapped[];
  subscribe(listener: (value: LooseWrapped[]) => void): () => void;
  [index: number]: LooseWrapped;
  [Symbol.iterator](): Iterator<LooseWrapped>;
  [key: string]: any;
}
