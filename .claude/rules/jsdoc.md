# JSDoc Rules

Rules for writing JSDoc comments on exported symbols in a TypeScript package.
Apply every rule to every symbol you write or edit.

## Summary line

The first paragraph is the only part shown in editor tooltips, autocomplete
lists, and search indexes. Write it as one concise sentence describing what the
symbol does, so a reader scanning an autocomplete list can pick the right symbol
without opening anything else.

Put implementation details, caveats, and rationale in later paragraphs.

```ts
/** Replaces all spaces in a string with underscores. */
```

## Types

Carry type information in the TypeScript signature. Describe meaning in the
comment: what the value represents, its valid range, and any sentinel value.

```ts
/**
 * Finds a substring and returns the index of its first occurrence.
 *
 * @param value The string to search.
 * @param needle The substring to search for.
 * @returns The index of the first occurrence, or -1 when the needle is absent.
 */
declare function find(value: string, needle: string): number
```

Reserve `@param` and `@returns` for facts the signature cannot state — the `-1`
above is the case that earns the tag.

## Examples

Add `@example` for symbols with several parameters or non-obvious behaviour. The
text on the `@example` line is the title; the text below the code block is its
description. Include the `import` statement so the block runs when pasted.

````ts
/**
 * @example Basic usage
 * ```ts
 * import { move } from "@std/fs/move";
 *
 * await move("./foo", "./bar");
 * ```
 *
 * This moves `./foo` to `./bar` without overwriting.
 */
````

Write one example per distinct use case.

## Coverage

Document every exported symbol: functions, classes, interfaces, type aliases.
For classes and interfaces, document the symbol itself plus each constructor,
method, and property.

When a package exposes several modules, put a `@module` comment at the top of
each module file with a summary paragraph and a usage example. Its first
paragraph becomes the module's description on the package index.

```ts
/**
 * Contains the middleware application, the core concept of oak.
 *
 * @module
 */
```

## Markdown

Write comment bodies in Markdown: headings, bullet lists, bold, block quotes,
links, and inline code.

## Internal links

Link to other symbols in the package with `{@linkcode}` (renders as code),
`{@link}`, or `{@linkplain}`. These become clickable in editor tooltips and in
generated docs. References to built-in objects such as `ArrayBuffer` resolve to
MDN.

```ts
/** Options for styling text with the {@linkcode print} function. */
```

## Freshness

Edit the JSDoc in the same change as the code it describes. Where the toolchain
supports it, type-check the example blocks (`deno test --doc`) and lint public
symbols for missing comments and return types (`deno doc --lint`) before
publishing.

In this repo that check is `pnpm docs:check` (`scripts/doccheck.ts`, run by
Node with the TypeScript compiler API). It fails when an entry file lacks a
`@module` comment, when a symbol reachable from an entry point has no JSDoc
block — exports, plus the interfaces their types are built from and every
member of those interfaces, and every module-level export under `src/` — and it
type-checks every code block in the public documentation as its own module that
imports from `e5x` / `e5x/jsx`. An example
missing its `import` therefore fails the build rather than merely reading badly.
It also checks `docs/API.md`: every export and every `$` member of wrapped
elements, collections, and columns needs a section whose heading names it in
backticks (`` `collection.$where(...)` ``), with a `**Type:**` line and an
example, and those examples are type-checked the same way. Change the reference
in the same change as the API. CI runs it on every push.

## Renderer-dependent syntax

These render only on some documentation sites — confirm the target renderer
supports them before use:

- `> [!IMPORTANT]` alert blocks (JSR).
- `@example` title/description splitting (JSR renders it; plain JSDoc does not).
- `@typeParam` is a TSDoc tag; `@template` is the JSDoc equivalent. Use whichever
  the repo already uses, consistently.

## Applying these rules in e5x

- The package has two entry points, so both carry a `@module` comment:
  `src/index.ts` (examples import from `e5x`) and `src/jsx.ts` (examples import
  from `e5x/jsx`, written as ` ```tsx ` blocks).
- The public types live in `src/types.ts`. Internal interfaces that surface
  through exported aliases (`CollectionBase`, `ElementAtom`, `WrappedBase`) are
  documented like exports, members included.
- "Every exported symbol" includes internal modules: every module-level
  `export` under `src/` (and each member of an exported interface) gets JSDoc,
  so maintainers get the same tooltips. Internal symbols need no `@example` —
  they cannot be imported by the package name, so examples could not be
  type-checked — and internal files need no `@module`.
- A comment explaining a non-exported helper, or one line of an
  implementation, stays a `//` comment.
- This repo has no JSR renderer, so avoid the renderer-dependent syntax above.
  Keep `@example` titles short — they read as a plain line in editor tooltips.
- `@template` is the tag to use for type parameters.
- Examples follow the repo's formatting: no semicolons, single quotes.
- Verify with `pnpm docs:check`, `pnpm typecheck`, and `pnpm test` in the same
  change.
