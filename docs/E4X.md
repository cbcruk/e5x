# Reading ECMA-357 (E4X)

Notes from reading the whole E4X standard (ECMA-357, 1st edition, June 2004) against what e5x
has built. Section numbers below refer to the standard.

CLAUDE.md calls E4X the project's "출발점이자 정신적 원형". This page records what the spec
actually says, where e5x agrees, where it diverges, and — the reason the reading paid off — which
of e5x's open questions the spec had already answered.

This is a study note, not a decision record. Where it suggests something, that is a suggestion.

## 1. What the spec is

Two types, three operators, and one rule repeated everywhere.

- **XML** (§9.1): an ordered collection of properties with a name, an attribute set, in-scope
  namespaces and a parent. Children are numeric properties (`"0"`, `"1"`, …). `[[Class]]` is one
  of `element`, `attribute`, `comment`, `processing-instruction`, `text`.
- **XMLList** (§9.2): an ordered collection of numeric properties, plus `[[TargetObject]]` and
  `[[TargetProperty]]`.
- The rule: _"E4X intentionally blurs the distinction between an individual XML object and an
  XMLList containing only that object."_ It appears in §9.1, §9.2, §10.1.2, §11.2.1, §11.2.2.1,
  §12.2, §13.4.3.10, §13.5.4. It is why `XML.prototype.length()` always returns `1`, why
  `[[HasProperty]]("0")` on an XML object is always `true`, and why `x[0]` is `x`.

The design principles (§6) worth keeping:

- **Minimal** — "It is a non-goal of E4X to provide, for example, the full functionality of XPath."
- **Loose Coupling** — "applications should be able to extract a value deeply nested within an XML
  structure, without specifying the full path to the data". This is the stated reason `..` exists.
- **Complementary** — when more expressive power is needed, call out to another language. Annex A's
  optional `xpath()` is that escape hatch.

## 2. Where e5x already matches

| E4X                                                                          | e5x                                     |
| ---------------------------------------------------------------------------- | --------------------------------------- |
| XML `[[Get]](name)` → XMLList (§9.1.1.1)                                     | `sales.item`                            |
| XMLList `[[Get]](name)` = `[[Get]]` on each member, concatenated (§9.2.1.1)  | `rows.amount` → `Column`                |
| `..name` = `[[Descendants]]` (§9.1.1.8, §11.2.3)                             | `$deep(name)`                           |
| `.(predicate)` (§11.2.4)                                                     | `$where`                                |
| `delete list[i]` removes from the parent too (§9.2.1.3)                      | `delete view[i]`                        |
| `for each (x in list)` (§12.3)                                               | `for (const x of view)`                 |
| `length()` as a **call**, to keep it off the data namespace (§11.2.2)        | `$length`, prefixed for the same reason |
| Annex A.1.1 `domNode()`                                                      | `$el`                                   |
| §10.3.2 `ToXML` applied to a W3C Information Item, with **Map-to** semantics | `wrap(element)`                         |

Two of these deserve more than a table row.

**`Column` is the spec's XMLList `[[Get]]`.** Phase 3 derived "collection field = column" from the
data-table demo. §9.2.1.1 specifies exactly that: getting a name from a list gets it from every
member and concatenates the results. e5x added aggregates on top; the shape was already standard.

**e5x is in the spec.** §10.3.2 defines `ToXML` over a W3C XML Information Item and introduces
_Map-to_: "changes to the first argument will result in changes to the second argument and
vice-versa". Its example is a DOM wrapper:

```
function createTable() {
  var doc = XML(document);
  var mytablebody = doc..body.TABLE.TBODY;
  mytablebody.TR[0] = "";
  doc..body.TABLE.@border = 2;
}
```

So "E4X over live DOM" is an optional feature of ECMA-357, not an extrapolation from it. What e5x
adds on top is the subscribe axis, which the spec has nothing to say about.

## 3. Where e5x diverges, and what the spec says there

### 3.1 The filtering predicate is `with`

§11.2.4 evaluates `.(Expression)` by pushing the current element onto the **front of the scope
chain**, so `name == "John"` and `@id == 1` resolve as bare identifiers. The spec spells out the
desugaring itself:

```
for each (var p in e..employee) {
  with (p) { if (@id == 0 || @id == 1) { … } }
}
```

`with` is a syntax error in strict mode, and ES modules are always strict. A runtime library
therefore cannot reproduce `.()` — not as a matter of taste but of the language. `$where(el => …)`
and `$where({ field: value })` are the available shapes, and the deps mechanism (Phase 10) exists
because the predicate is a closure rather than an expression re-evaluated in a scope.

### 3.2 Library vocabulary vs data vocabulary

§11.2.2 states the problem e5x settled with the `$` prefix, and its own answer:

> Unlike values of type Object, values of type XML and XMLList store and retrieve properties
> separately from methods so that XML method names do not clash with XML property names.

with the canonical example `rectangle.length()` (one `<rectangle>`) vs `rectangle.length` (the
`<length>` child). Method lookup goes through `Object [[Get]]` on the prototype and **never**
through XML `[[Get]]` (§11.2.2.1). E4X keeps two namespaces and disambiguates them with **call
syntax**. A Proxy `get` trap cannot see whether its result will be called, so the split has to be
in the name. This is the same conclusion CLAUDE.md reached, with the spec's reasoning behind it.

### 3.3 Coercion differs in substance

E4X coerces by `hasSimpleContent()` (§10.1.1, §13.4.4.16, §13.5.4.13):

- an XML object with no child elements stringifies to its text; **one with child elements
  stringifies to its markup** via `ToXMLString`.
- an XMLList of length 1 delegates to its single item; a longer list containing elements is _not_
  simple content, so `String(order.item.price)` over two items yields
  `<price>1299.99</price><price>399.99</price>`.

e5x always coerces to the **first** member (`src/collection.ts`, `src/column.ts`) and a wrapped
element always coerces to `textContent` (`src/wrap.ts`), regardless of content shape. The trade is
visible: E4X makes a multi-match coercion obviously wrong at the call site, e5x silently picks one.
e5x has no `hasSimpleContent` notion and no `toXMLString` counterpart.

### 3.4 A new field is an element in E4X, an attribute in e5x

§9.1.1.2 step 13: assigning to a name that is not an `AttributeName` and matches nothing creates a
new **element** child. Attributes are written only through `@`. e5x writes `setAttribute` when no
same-named child exists, which is the opposite default; the `'<string>'` descriptor added in
Phase 10 closes the gap for typed fields but not for loose mode.

E4X also **deletes the other matches**: when several children share the name, `[[Put]]` replaces
the first and removes the rest (step 12). e5x writes the first and leaves the rest alone.

### 3.5 XMLList is a snapshot; an e5x collection is a live view

This is the deepest difference and the root of several friction entries. An XMLList is an ordinary
ordered collection of XML values that need not share a parent — which is why `+` can build one out
of two documents (§11.4.1). An e5x collection is always "the members of this node's subtree that
match", recomputed from the DOM. It cannot be concatenated, which is exactly the reader app's
"문서 간 collection 합치기 없음" (`apps/reader/FRICTION.md`).

The live view buys reactivity and memoisation; the snapshot buys composition. e5x picked the first
deliberately. The cost is now named.

## 4. Questions e5x left open that the spec already answers

Three of these were taken in #28 and are marked below; the rest stayed open, with reasons.

### 4.0 `in` — the one the spec did not answer so much as expose

`[[HasProperty]]` (§9.1.1.6, §9.2.1.5) asks the element about its children and attributes. e5x had
no `has` trap, so `in` reached the proxy target and answered for `Element.prototype`: `false` for
`'item'` and `'vendor'` that exist, `true` for `'title'` and `'id'` that do not. The spec's rule was
also the fix, and it gives loose mode the presence test the README had to spell out as
`$length.get()`.

**Status:** grafted (#28), on wrapped elements and collections.

### 4.1 What `collection[i] = x` should mean

CLAUDE.md parks this: "대입을 element 교체로 의미 부여하는 안은 보류(복사 vs 이동 의미론 미결)".
§11.6.2 decides it. Index assignment on an XMLList replaces the property with a **deep copy** of the
given value, and if the replaced item has a parent it is replaced in the parent's context too. The
append idiom follows from the same rule:

```
e.employee[e.employee.length()] = <employee><name>Frank</name></employee>;
```

Note which type throws: **XML** `[[Put]]` with a numeric name throws `TypeError` ("reserved for
future versions", §9.1.1.2 step 3), while **XMLList** `[[Put]]` with an index assigns. e5x's
collection corresponds to XMLList, so today's `TypeError` on `c[0] = x` is the XML rule applied to
the XMLList position.

**Status:** still on hold, and the reading changed why. The spec's answer is conditioned on E4X
values being trees you own: assignment inserts copies everywhere. e5x's values are live nodes, so a
copy would leave every subscription, listener and cached proxy pointing at the original while the
clone is what the page shows. This is the one place where the spec has an answer and it does not
transfer. `$push` also already covers the append idiom, which Minimal argues against duplicating.

### 4.2 Writing through a path that does not exist yet

`[[TargetObject]]`, `[[TargetProperty]]` and `[[ResolveValue]]` (§9.2.1.10) exist for one purpose:
an empty XMLList remembers where it came from, so writing to it materialises the missing element in
the parent. `order.item.saledate = "05-07-2002"` works when no `<saledate>` exists.

e5x has a piece of this: a loose-mode miss returns an empty collection that still knows its parent,
so `$push` and `subscribe` work on it (CLAUDE.md records that decision, and that it matches E4X).
`[[ResolveValue]]` is the finished form — it resolves recursively up the chain.

### 4.3 The sibling axis

E4X has no sibling axis either. It has `parent()` (§13.4.4.27) and `childIndex()` (§13.4.4.7), and
the workaround is `x.parent().*[x.childIndex() + 1]`. e5x has neither, which is why `apps/hn` had to
leave through `$el.nextElementSibling` (FRICTION 1). Two members — a parent and an index — would put
the same workaround back inside the vocabulary.

**Status:** grafted (#28) as `$next` / `$prev`, one member instead of E4X's three. They return the
sibling as a loose wrapped element, which is an atom, so friction 1b is covered too: a row can
subscribe to its own byline instead of the whole page.

### 4.4 Combining lists

`+` concatenates two XML/XMLList values into a new XMLList (§11.4.1); `+=` on a list-valued path
inserts into the **parent** just after the left-hand side (§11.6.3, with a worked before/after
example). That is the shape the reader app wanted.

### 4.5 String methods on a leaf

`CallMethod` (§11.2.2.1) falls back twice: to the single item of a length-1 XMLList, and — when the
base is an XML object with simple content — to `ToObject(ToString(base))`. So `shipto.name.toUpperCase()`
and `shipto.citystatezip.split(", ")` work with no explicit text selection. In e5x an unknown
non-`$` name on a leaf is `undefined`; delegating to the string value would not collide with the
`$`-prefix rule.

**Status:** rejected. The fallback needs a detectable miss. In e5x a missing loose name is an empty
collection — a deliberate decision `$push` and `subscribe` depend on — so there is no miss to hook,
and delegating would make the same path yield a collection for one element and a function for
another, depending on whether the data happens to be there. Typed leaves and loose attributes are
already plain strings, so `.toUpperCase()` works on them today; the remaining gap is a loose child
element's text, which `$text` (§13.4.4.37, grafted in #28) covers.

### 4.6 Wildcards

`x.*` (all children), `x.@*` (all attributes), `..*` (all descendants). e5x has `$attr` for the
attribute side and nothing for "every child element".

### 4.7 The escape hatch is sanctioned

Annex A.1.3 `xpath()` follows from Minimal + Complementary: keep the core small, and call a more
expressive language when needed. `$deep('tr.athing', schema)` taking a CSS selector (`apps/hn`) is
that principle, not a compromise of it.

## 5. What not to take

- **The namespace machinery** — `AttributeName`/`QName`/`Namespace` objects, `[[InScopeNamespaces]]`,
  `[[AddInScopeNamespace]]`, `addNamespace`/`removeNamespace`/`namespaceDeclarations`, the
  `default xml namespace` statement (§9.3, §12.1, §13.2–13.3). A large share of the spec, for
  almost no return on HTML DOM. The reader app's `atom:link` friction lives here, but prefixed
  names read as plain names are the cheaper fix.
- **Text nodes as numeric children.** `order.item.*[1]` selecting a text node is right for authored
  XML and noise in HTML. e5x's element-only model is why it needs no `normalize()`, `text()`,
  `comments()` or `processingInstructions()`.
- **Global mutable settings** — `XML.ignoreWhitespace`, `prettyPrinting`, `settings()/setSettings()`
  (§13.4.3). Process-wide switches that change parse and serialisation results.
- **`typeof x === "xml"` and the `instanceof` blur** (§11.3.2, §13.4.3.10). Not reachable from a
  runtime library.

## 6. Reading the PDF

`ECMA-357.pdf` has no text layer extractable by the tools in this environment (no `pdftotext`, no
Python PDF library). The notes above were taken from a plain-text extraction: inflate every
`FlateDecode` content stream, walk the text-showing operators (`Tj`/`TJ`/`'`/`"`) tracking `Td`/`TD`/
`Tm`/`T*` for line positions, decode strings as CP1252 (the fonts are `WinAnsiEncoding`), then group
by `y` and sort by `x`. 103 pages come out readable; the algorithm numbering (`!!!1.`) and letter
spacing inside words are artefacts of that pass, not of the standard.
