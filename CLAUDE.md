# CLAUDE.md

## 프로젝트 한 줄 정의

E4X(ECMAScript for XML)의 **철학**을 현대 Web API / DOM 위에서 되살리는 라이브러리.
스펙 호환이 목표가 아니라 **shape-matched 인터페이스**(데이터의 모양 = 접근 경로)를
DOM 트리에 입히고, 그 위에 reactivity 한 겹을 얹는 것이 목표.

## 핵심 미학: shape-matched

데이터의 구조와 접근 어휘가 직접 일치한다. accessor verb(`getItems()`, `.children()`,
`findByType()`)가 끼지 않는다. 데이터 안에 `item`이 있으면 접근도 `.item`, 속성이
`type`이면 접근도 `.type`. 어휘는 한 번만 등장한다.

같은 가문의 검증된 인터페이스 (설계 시 참조):

- **E4X**: `sales.item.(@type=="carrot").@quantity` — 출발점이자 정신적 원형
- **pandas**: `df[df.type=='carrot'].quantity` — 같은 미학으로 data science를 장악
- **Enzyme**: `.find(Button)`, `.find({disabled:true})` — 데이터 어휘 = API 어휘
- **Drizzle ORM**: SQL 어휘 그대로의 builder

frontend JS에는 이 미학의 챔피언이 없다. jQuery가 한때 근처에 있었고 떠난 뒤 비어 있다.
**이 빈자리가 프로젝트의 존재 이유.**

## 통합 설계 방향

이전 탐색에서 behavior()/query() 두 레이어로 갈랐으나, 그건 reactivity 축만 푼 것이고
shape-matched 축이 비어 있었다. 결론: **두 축은 직교하므로 하나의 path 표현으로 합친다.**

```js
const sales = wrap(document.querySelector('sales'));

// shape-matched access (read)
sales.item                                    // live collection
sales.item.where({ type: 'carrot' }).quantity // → "10"
sales.vendor                                  // attribute access
sales.deep('price')                           // descendant 축 (E4X의 .. 대용)

// write — 같은 path
delete sales.item[0];
sales.item.push({ type: 'oranges', price: 4 });
sales.item.where({ type: 'oranges' }).quantity = 4;

// subscribe — 같은 path
sales.item.where({ done: false }).$length.subscribe(n => ...)
```

**핵심 불변식**: *같은 path 표현*이 read / write / subscribe 세 축 모두에 작동한다.
E4X가 가졌던 read/write 대칭에 subscribe 축을 하나 더 붙인 형태. 이건 E4X도 jQuery도
(mutable에선) pandas도 못 가진 자리.

## 런타임 vs 컴파일타임 경계 (확정된 제약)

**컴파일 필요 (Phase 1에서는 안 다룸)**:

- XML literal (`<sales>...</sales>`)
- 연산자 문법: `.()`(filter), `..`(descendant), `@`(attribute), `for each`
- → 이건 lexer mode-switching이라 Babel/SWC 플러그인 없이는 불가능

**런타임으로 가능 (Phase 1 범위)**:

- Proxy 기반 dot-notation traversal
- predicate filter → `.where({...})` 또는 `.where(el => ...)` 메서드로 대체
- descendant 축 → `.deep(name)` 메서드로 대체
- attribute access → child name과 통합 namespace (아래 참조)
- reactivity / two-way binding

XML literal과 연산자 문법은 컴파일 스텝을 받아들일 의향이 생겼을 때 Phase 2로.
**먼저 런타임 코어를 완성하고 가치를 검증한 뒤에 결정.**

## 결정해야 할 핵심 설계 질문

### child name vs attribute name 충돌

E4X는 `@`로 해결했다. JS에선 **single namespace + escape hatch**로 간다:

- `sales.vendor`가 attribute든 child든 그냥 동작 (99% 케이스는 어휘 층위가 달라 안 충돌)
- 충돌 시에만 `sales.$attr.vendor` 같은 출구 제공
- 이유: 실무에서 HTML attr과 child tag는 거의 안 충돌. 흔한 케이스를 짧게 만드는 게
  드문 케이스의 명시성보다 중요.

### live collection의 정체성

`query()` 실험에서 검증된 모델 유지:

- `get()` / `subscribe()` 인터페이스 = nanostores atom과 동일 shape (Standard Schema)
- 그래서 `effect(query(...), ...)`가 atom과 동등하게 작동 — atom과 query가 동격의
  reactive source가 되는 것이 설계의 수확
- `.where()`는 새 live derived set을 반환 (computed atom처럼)

## 기술 스택 / 구현 메모

- **파싱/순회**: DOMParser, Proxy, TreeWalker
- **반응성**: 단일 MutationObserver가 모든 live set을 구동.
  `{ childList: true, subtree: true, attributes: true }` —
  **`attributes: true` 필수** (class/data-\* 변화로 set 멤버십이 바뀌므로). 비결정적이지만 중요.
- **two-way binding**: Proxy set trap
- **애니메이션** (필요 시): Web Animations API, View Transitions API
- **reactivity 참조 모델**: nanostores(atom/computed), Svelte 5 runes($state/$derived/$effect),
  Solid/Preact signals, Vue ref, TC39 Signals proposal — 전부 같은 모델로 수렴함

## source of truth 규율 (중요)

상태를 들고 있는(state-bearing) 변화는 **한 쪽만** truth로 둔다. DOM에 직접 쓰는 것과
모델에 쓰는 것을 섞으면 동기화 버그가 터진다.

- 영속 상태 → 모델(atom)이 truth, DOM은 그 반영
- 일시적/상태 무관 변화 (flash 같은 효과) → DOM 직접 조작 허용
- `wrap().x = y` write가 둘 중 어느 쪽으로 흐르는지 API 차원에서 명확히 할 것

## 인접 선행 사례 (참조용, 정확히 이 자리는 아님)

- xmldom-ts, defiant.js — XML/DOM query 접근
- Vue 3 reactive proxy 내부 — deep proxy를 path-stable하게 유지하는 방법
- nanotags / nanostores (Evil Martians, Andrey Sitnik) — platform-leaning, framework-agnostic,
  sub-kB 미학. 같은 사상의 가문.

## 코딩 / 협업 규약

- **직접적인 기술적 정직함**을 선호. 외교적 완충 표현 불필요. 약점은 약점이라고 명시.
- 큰 결정 전에 작은 인터랙티브 데모로 검증하고 거기서 흘러나오는 코드에 API를 맞춘다
  (추측으로 API 정하고 use case 끼워맞추기 금지).
- 설계 근거는 기존의 well-regarded 인터페이스에서 가져온다 (맨땅에서 발명하지 않음).
- TypeScript: 셀렉터/path 기반 접근은 타입 추론이 약해진다. 제네릭 명시 또는 schema 주입으로
  early하게 풀 것. 미루면 나중에 전체 API를 다시 깎아야 함.

## 스코프에 대한 정직한 메모

이 프로젝트는 "낭만적 동기 + 비어있는 자리 + 검증된 미학" 세 박자가 갖춰져 있다.
다만 라이브러리로 정착하려면 둘 중 하나가 필요하다:

1. shape-matched라는 단 하나의 정체성을 끝까지 미는 것
2. 구체적 앱 하나로 API 모양을 강제하는 것 (데모 사이트를 이 라이브러리로 만드는 것도 방법)

"이게 없으면 매일 내가 불편한 게 뭔가"에 답이 있으면 강한 추진력. 없으면 학습 프로젝트로
끝나도 손해는 없다. **publish 할지 / 학습으로 끝낼지는 일찍 정하는 게 정직하다.**
이 판단은 코드를 진행하며 갱신할 것 — CLAUDE.md도 그에 맞춰 업데이트.

## 현재 단계

Phase 1: 런타임 Proxy 코어 **구현 완료 + 검증됨** (`pnpm test` 7/7 통과, happy-dom).

구현된 것:

- `wrap(element)` — element당 안정적 Proxy (WeakMap 캐시, path-stable identity)
- live collection — index 접근, `length`/`$length`, `where()`, `deep()`, `push()`, `delete`,
  iteration, `get()`/`subscribe()` (nanostores atom shape)
- read / write / subscribe 세 축이 **같은 path 표현**으로 작동 (핵심 불변식 검증됨)
- 단일 MutationObserver가 모든 live set 구동 (`childList + subtree + attributes`)
- todo 데모(`demo/main.ts`, `pnpm dev`)가 API driver

빌드 중 확정된 설계 결정:

- **unified namespace 해석 순서**: child element 우선 → 없으면 attribute. (canonical sales 예제는
  전부 attribute라 자동으로 attr로 떨어짐)
- **write 기본값**: 같은 이름 child가 있으면 그 textContent, 없으면 `setAttribute`.
  즉 새 필드는 attribute로 생성됨.
- **collection.field 접근**은 첫 멤버에 위임 (Phase 1 한계 — E4X의 "전체 map" 의미론 아님).
- **leaf element coercion**: 단일 멤버 collection / wrapped leaf는 `Symbol.toPrimitive`로
  textContent에 coerce → `String(sales.item.where(...).quantity) === "10"`.
- **subscribe**는 현재 값으로 즉시 1회 발화 후 mutation마다 (nanostores 동작).
- **escape hatch**: `.$el`(raw element), `.$attr.name`(attribute 강제).

## Phase 2: 타입 (schema 주입) — **구현 완료 + 검증됨** (`pnpm test` 11/11)

핵심 결정: **descriptor 객체 하나가 single source of truth** — 런타임 coercion 정보와
컴파일타임 타입 추론을 동시에 제공 (Standard Schema 정신). schema를 두 번 안 쓴다.

```ts
const sales = wrap(el, {
  vendor: 'string',
  item: [{ type: 'string', price: 'number', quantity: 'number' }],
} as const);

sales.vendor                              // string
sales.item.where({ type: 'carrot' }).price  // number  ← 추론됨
sales.item[0].quantity                    // number
sales.item.$length.subscribe((n) => ...)  // n: number, annotation 불필요
sales.item.push({ type: 'x', price: 4 })  // typed write
```

descriptor 문법:

- leaf: `'string' | 'number' | 'boolean'` → 런타임에 `Number()` / `=== 'true'`로 coerce
- children: `[childDescriptor]` (배열 1-tuple) → `Collection<child>`
- `wrap<const N>` 제네릭 + `as const` (또는 inline literal)로 리터럴 타입 보존
- descriptor 없는 `wrap(el)`은 loose 모드 (전부 `any`/string, Phase 1 동작 유지 — 하위 호환)

write coercion: `String(value)`로 DOM에 기록 (boolean→`'true'`/`'false'`, number→str).
read coercion만 타입별 분기. write는 단방향이라 String()으로 충분.

## Phase 3: 데이터 테이블 데모로 API 압박 — **완료** (`pnpm test` 21/21)

데이터 테이블(pandas 미학)을 driver로 잡으니 Phase 2의 한 가지 약점이 즉시 깨졌고,
거기서 흘러나온 코드에 API를 맞췄다 (CLAUDE.md "데모가 API를 강제한다" 규율).

**깨진 계약 → 고친 것**: Phase 2에서 `collection.field`는 "첫 원소 scalar"였다.
테이블에서는 `rows.amount`가 **열 전체**여야 집계가 된다. shape-matched 원칙(accessor
verb 금지)상 `rows.column('amount')` 같은 verb는 불가. 결론:

- **element field = scalar**: `row[0].amount` → `number`
- **collection field = Column**: `rows.amount` → `Column<number>` —
  `.$sum / .$avg / .$min / .$max / .$values / .$length`, indexable, iterable,
  단일 원소는 첫 값으로 coerce. 집계 atom은 mutation에 반응(atom = query 동격 재확인).
- scalar가 필요하면 `[0]`로 명시: `rows.where({id:1})[0].amount`

추가된 것:

- `sort(field, 'asc'|'desc')` + `sort(comparator)` → 정렬된 live collection.
  descriptor가 비교 방식 결정(number는 수치, string은 사전식).
- **bulk write 비대칭 문제**: `rows.active = false`는 read 타입이 `Column<boolean>`이라
  TS로 표현 불가(read=Column/write=scalar 비대칭은 mapped type 한계).
  → typed bulk write는 **iteration**: `for (const r of rows.where(...)) r.active = false`.
  → loose 모드에서만 property-assign bulk 허용(런타임은 양쪽 다 동작).

데모: `index.html` + `demo/main.ts` (filter/sort/edit/delete/add/집계/live total).
`pnpm dev`로 확인.

## Phase 4: observer fan-out 성능 — **완료** (`test/perf.test.ts`)

이전: mutation batch마다 **모든** live atom의 `compute()` 재실행 (O(sets × mutations)).
지금: `watch` listener가 `MutationRecord[]`를 받고, `derived`가 **자기 root subtree와
무관한 mutation이면 recompute를 건너뛴다** (`affects(node, records)` —
`target === node || node.contains(target)`).

검증: 20개 독립 트리 중 1개에 push → recompute가 그 트리에서만 일어남(predicate 호출
4회, 이전엔 60회). 결정적 테스트로 박아둠(타이밍 의존 아님).

남은 성능 한계: relevance 체크가 listener당 O(records). disjoint subtree가 많을 때 큰
이득, 단일 큰 트리에선 이득 없음(무해). 진짜 대량 데이터는 측정 후 인덱싱 고려.

## Phase 5: transpiler(XML literal) — **spike 완료** (`src/jsx.ts`, `test/jsx.test.tsx`)

CLAUDE.md가 "컴파일 스텝 수용 의향" 게이트로 둔 영역. **무엇을 얻는지** 실제 동작으로 검증:

```tsx
const sales = wrap(
  <sales vendor="John">
    <item type="peas" price="4" />
    <item type="carrot" price="3" />
  </sales> as Element,
  schema,
);
sales.item.price.$sum.get(); // 7
```

- JSX pragma(`h`/`Fragment`)로 XML literal → 실제 DOM → `wrap()`. esbuild jsxFactory +
  tsconfig jsx 설정. interpolation/array children 동작(`{types.map(...)}`).
- **정직한 범위**: 이건 XML literal **저작**만 검증. E4X 연산자 문법(`.()` filter,
  `..` descendant, `@` attribute, `for each`)은 lexer mode-switching이라 **커스텀 파서
  필요** — 아직 안 함. 그건 진짜 transpiler 프로젝트(Babel/SWC 포크 급).
- 더 싼 대안(미구현): `xml\`<sales>...\`` 태그드 템플릿 → DOMParser 런타임 파싱.
  컴파일 스텝 0이지만 문자열이라 타입/interpolation 안전성 없음. 트레이드오프 기록만.

판단: XML literal 저작은 JSX로 충분히 입증됨. 연산자 문법까지 가려면 커스텀 파서라는
큰 결정이 필요하니, 그건 "정말 필요한가"를 더 본 뒤에.

## Phase 6: 패키징 — **완료** (소비자 관점 검증됨)

- `vite-plugin-dts`로 `.d.ts` 발행 (멀티 엔트리: index + jsx).
- `exports` map: `e5x` (메인) / `e5x/jsx` (옵트인). **JSX는 subpath로 분리** —
  전역 `JSX` 네임스페이스 선언이 메인 import에 새지 않도록 (index.d.ts 깨끗함 확인).
- `sideEffects: false`, `files: ["dist"]`, README, LICENSE(MIT), version 0.1.0.
- 검증: tarball을 별도 프로젝트에 설치 → `import { wrap } from 'e5x'` /
  `import { h } from 'e5x/jsx'`가 exports map으로 해석되고 타입까지 흐름을 tsc로 확인.

**publish 결정은 보류 중** — npm publish는 되돌리기 어려운 외부 행위라 사용자 명시 승인 필요.
패키징은 준비 끝. "이게 없으면 매일 불편한가"에 대한 본인 답이 publish 추진력. 아직 미정.

## 알려진 약점 (정직하게)

- bulk write read/write 비대칭 → typed에선 iteration 강제.
- `deep()` 결과는 항상 loose (descendant는 schema에 없음). 의도된 한계.
- descriptor의 child는 1-tuple만 — heterogeneous children 미지원.
- JSX spike의 `h`는 전역 `document` 의존(SSR 불가) + 전역 `JSX` 네임스페이스 선언
  (React와 충돌 가능). spike 한정.

## 다음 후보

- 패키징(.d.ts, exports map, vite-plugin-dts) → npm publish 여부 결정
- E4X 연산자 문법 커스텀 파서 (진짜 transpiler) — 큰 결정, 수요 확인 후
- 대량 데이터 인덱싱 (selector→set 역색인) — 실측 병목 나오면
