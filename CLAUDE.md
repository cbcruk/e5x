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
sales.item                                        // live collection
sales.item.$where({ type: 'carrot' })[0].quantity // → 10
sales.item.quantity                               // Column (열 전체)
sales.vendor                                      // attribute access
sales.$deep('price')                              // descendant 축 (E4X의 .. 대용)

// write — 같은 path
delete sales.item[0];
sales.item.$push({ type: 'oranges', price: 4 });
sales.item.$where({ type: 'oranges' })[0].quantity = 4;

// subscribe — 같은 path
sales.item.$where({ done: false }).$length.subscribe(n => ...)
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
- predicate filter → `.$where({...})` 또는 `.$where(el => ...)` 메서드로 대체
- descendant 축 → `.$deep(name)` 메서드로 대체
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

### 라이브러리 어휘 vs 데이터 어휘 — **결정됨 (2026-09)**

attr/child 충돌보다 흔한 건 **API 이름과 필드 이름** 충돌(`length`, `sort`, `push`…)이었다.
결정: **bare = 데이터, `$` = 라이브러리.** `$where/$sort/$push/$deep/$length/$sum/$el/$attr`.

- 근거: E4X는 동사를 호출(`length()`)로 데이터와 갈랐다 — Proxy get은 호출 여부를 모르므로
  JS에선 불가, 대신 접두사로 가른다. MongoDB(`$where/$sort/$push`), Vue(`$el/$attrs`) 선례.
  기존 `where`(bare) + `$sum`(`$`) 혼재도 규칙 하나로 정리됨.
- **예외는 atom 프로토콜 `get`/`subscribe`** (+ JS 훅 `toString`/`valueOf`). collection이
  Svelte store 계약(get/subscribe)을 만족해야 "atom과 query 동격"이 유지됨. Promise의
  `then`처럼 프로토콜 이름은 bare로 둔다. (Phase 10부터 wrapped element도 atom이라 원소
  레벨에서도 예약.)
- 예약 이름(위 4개 + `$*`)을 schema에 쓰면 **컴파일 에러**(필드를 짚는 메시지) + `wrap()` 런타임
  TypeError. loose 모드에서 그 이름의 데이터는 `$attr`로만 접근.
- sync `length` 제거 → `$length.get()`. 알 수 없는 `$` 이름은 데이터로 해석하지 않고 `undefined`.
- 비용: `.$where`가 `.where`보다 시끄럽다. 충돌 없는 이름 공간과 맞바꾼 것.

### live collection의 정체성

`query()` 실험에서 검증된 모델 유지:

- `get()` / `subscribe()` 인터페이스 = Svelte store 계약과 동일 shape
- 그래서 get/subscribe만 요구하는 소비자(Svelte `$store`/`derived`, e5x `computed`)에게 atom과
  query가 동격의 reactive source — 이것이 설계의 수확
- **정정 (Phase 10, nanostores 1.5.3 소스 확인)**: nanostores `computed`는 `listen`/`eq`와 전역
  `nanostoresGlobal.epoch`를 요구해 e5x atom을 받지 못한다. "nanostores atom과 동일 shape"는
  사실이 아니었다. 호환하려면 nanostores 내부 epoch에 결합해야 해서 하지 않음.
- `.$where()`는 새 live derived set을 반환 (computed atom처럼)

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
- live collection — index 접근, `$length`, `$where()`, `$deep()`, `$push()`, `delete`,
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
  textContent에 coerce → `String(sales.item.$where(...).quantity) === "10"`.
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
sales.item.$where({ type: 'carrot' }).price  // number  ← 추론됨
sales.item[0].quantity                    // number
sales.item.$length.subscribe((n) => ...)  // n: number, annotation 불필요
sales.item.$push({ type: 'x', price: 4 })  // typed write
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
- scalar가 필요하면 `[0]`로 명시: `rows.$where({id:1})[0].amount`

추가된 것:

- `$sort(field, 'asc'|'desc')` + `$sort(comparator)` → 정렬된 live collection.
  descriptor가 비교 방식 결정(number는 수치, string은 사전식).
- **bulk write 비대칭 문제**: `rows.active = false`는 read 타입이 `Column<boolean>`이라
  TS로 표현 불가(read=Column/write=scalar 비대칭은 mapped type 한계).
  → typed bulk write는 **iteration**: `for (const r of rows.$where(...)) r.active = false`.
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
  (
    <sales vendor="John">
      <item type="peas" price="4" />
      <item type="carrot" price="3" />
    </sales>
  ) as Element,
  schema,
)
sales.item.price.$sum.get() // 7
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

**결정(2026-06): GitHub 공개, npm 보류.** repo: https://github.com/cbcruk/e5x (main).
npm publish는 실제 소비처가 생기면 — "이게 없으면 매일 불편한가"의 답이 나오면 — 그때.
패키징/타입/exports는 소비자 관점까지 검증 끝났으니 publish 자체는 명령 하나.

## 버그 수정 라운드 (2026-09) — `pnpm test` 31/31

- **observe 대상 = 구독된 노드 자체** (이전: `ownerDocument.documentElement`). detached 트리,
  shadow root에서 반응성이 조용히 죽던 문제 수정. `getRootNode()`가 아니라 노드 자체인 이유:
  MutationObserver 등록은 노드를 따라다니므로 fragment/detached 트리가 나중에 document로
  이동해도 유지됨. observer는 여전히 단일 인스턴스.
- **collection/Column에 DOM 의미 없는 대입 거부**: `c[0] = x`는 TypeError(이전엔 내부 api
  객체에 `"0"`이 박혀 영구 오염), API 멤버(`where` 등) 덮어쓰기와 Column 대입/삭제도 거부.
- **loose 모드의 없는 이름 → 빈 collection (truthy) 유지 결정**. E4X와 같은 의미론이고,
  빈 상태에서 시작하는 loose `$push`/`subscribe`가 이것에 의존. 존재 확인은 `$length.get()`으로
  (README에 문서화).

## Phase 7: 읽기 경로 메모이제이션 — **완료** (`pnpm test` 42/42, `test/memo.test.ts`)

측정 먼저 (happy-dom, 2000행):

| 시나리오                                | 이전                          | 이후                       |
| --------------------------------------- | ----------------------------- | -------------------------- |
| held `$where().$sort()` 뷰에 `v[i]` × N | 16,157ms (predicate 400만 회) | 9ms (2000회)               |
| `rows.n[i]` 열 순회 × N                 | 2,172ms                       | 3ms                        |
| `$sort('n').get()` × 20 (새 뷰)         | 283ms                         | 32ms                       |
| 구독 20개 × attr write                  | 40,000 predicate/write        | 동일 (독립 뷰라 공유 없음) |

구조:

- **노드별 version** (`reactive.ts`): observe 중인 노드의 subtree에 mutation이 오면 조상을 타고
  올라가며 version++. `memo(node, compute)`는 version이 같으면 캐시 반환.
- **동기 쓰기 후 읽기**: MO는 비동기 → 읽을 때마다 `observer.takeRecords()`로 pending을 끌어와
  version을 올린다. 구독자 통지는 microtask로 유지.
- 구독자 relevance가 `affects(node, records)` O(records)에서 version 비교 O(1)로 바뀜
  (Phase 4의 남은 한계 해소).
- `characterData: true` 추가 — child text 필드를 text node로 고치는 경우가 캐시를 낡게 만들기 때문.
- **path identity**: `sales.item === sales.item`, `rows.amount === rows.amount`,
  `$deep(name)`도 캐시. 안 그러면 `sales.item[i]` 루프가 매번 새 collection을 만들어 memo 무용.
- 정렬은 키를 한 번만 읽음 (비교마다 `readRaw` 하던 것 제거).
- Column `get()`은 복사본 반환 (공유 캐시 오염 방지).

같이 고친 버그: typed leaf(`price: 'number'`)가 child element로 저장돼 있으면 `rows.price`가
Column이 아니라 Collection을 반환했다(타입은 Column). 이제 schema가 kind를 결정, loose만 DOM 판정.

의미론 변화(의도됨): 뷰는 **DOM에만 의존**한다. predicate/comparator가 외부 상태를 읽으면
그 상태 변화는 추적 안 됨 → 새 뷰를 만들 것 (README 문서화). 이전에도 subscribe는 같은
의미였고, pull read만 우연히 매번 재계산했을 뿐.

비용: gzip 2.37 → 2.95kB. 캐시된 collection이 마지막 결과 배열(제거된 element 포함 가능)을
다음 읽기까지 붙잡는다. 읽은 모든 root가 observe 대상이 되어 mutation마다 O(depth) 조상 순회.

## Phase 8: 구독 간 계산 공유 + fan-out 인덱싱 — **완료** (`pnpm test` 49/49)

측정 (happy-dom):

| 시나리오                                         | 이전                   | 이후                             |
| ------------------------------------------------ | ---------------------- | -------------------------------- |
| 같은 predicate 함수로 뷰를 20곳에서 생성·구독    | predicate 40,000/write | 2,000/write                      |
| 같은 객체 predicate 20곳, write 10회             | 125ms                  | 29ms                             |
| disjoint 트리 1000개 구독, 한 트리에 write 200회 | 1,981ms                | 292ms (상당 부분 await 오버헤드) |
| 새 `$sort('n').get()` × 20                       | 32ms                   | 6ms (정렬 뷰 공유)               |
| inline arrow predicate 20곳                      | 40,000/write           | 동일 — 원리상 공유 불가          |

구조:

- **같은 path = 같은 뷰**: `$where(obj)`는 정규화 키(키 정렬 + 값 타입 + 문자열)로, 함수
  predicate/comparator는 identity(WeakMap)로, `$sort(field, dir)`와 `$deep(name)`은 문자열 키로 캐시.
  키 동등이 매칭 동등을 보장하는 원시값(string/number/boolean)일 때만 공유 — 그 외는 전용 뷰.
- 문자열 키 캐시는 **WeakRef + FinalizationRegistry** (`src/cache.ts`): 검색창처럼 키가 무한히
  늘어나는 경우에도 붙잡지 않은 뷰는 GC. `--expose-gc`로 수동 확인(결정적 테스트 불가).
- 객체 predicate는 생성 시 **snapshot** — 공유 키 아래 뷰가 호출자 객체 변경으로 오염되지 않게.
  (의미론 변화: 이전엔 호출자가 객체를 고치면 다음 재계산에 반영됐음.)
- 집계 atom(`$sum/$avg/$min/$max/$length`) 공유. 배열 atom(`$values`, column `subscribe`)은
  구독자별 복사본 유지 — ④에서 `$values.get()`이 호출자 간 같은 배열을 주던 구멍도 여기서 막음.
- **listener를 노드별로 인덱싱**: mutation이 version을 올린 노드의 구독자만 깨운다
  (이전: 페이지의 모든 구독자 순회).

비용: gzip 2.95 → 3.42kB.

## Phase 9: 데모 재작성 — sales ledger (`pnpm dev`, `test/demo-smoke.test.ts`)

이전 데모(데이터 테이블)는 수동 `refresh()`로 그렸고 subscribe는 한 곳뿐이었다. 지금은
**UI의 모든 반영이 e5x 구독**이고, 막힌 곳은 우회를 숨기지 않고 주석으로 남겼다.

- 모델: E4X canonical `sales` (attribute + `<note>` child text), 서버 렌더 마크업이 seed,
  JSX 리터럴(`demo/seed.tsx`)로 항목 추가.
- 표: `view.subscribe` → 행, `view.price.subscribe` 등 → 셀. 편집/`delete view[i]`/반복 bulk
  write/`$push`. 필터·정렬은 새 뷰를 만든다(뷰는 DOM에만 의존).
- 통계: `$length`, `quantity.$sum`, `price.$avg/$min/$max`, `$deep('note').$length`.
- dept 막대: `sales.item.$where({ dept })`가 표 필터와 **같은 객체**임을 하이라이트로 보임.
- 외부 쓰기: `setAttribute`/`textNode.data`/`remove()`/JSX append — e5x 밖에서 써도 반영.
- 모델 패널: 직렬화된 `<sales>` 트리.
- 테스트는 셀렉터 확인이 아니라 데모를 **실제로 조작**하는 7개 시나리오. 헤드리스 Chromium
  스크린샷으로 데스크톱/400px/다크 모드 확인.

**데모가 드러낸 API 공백** → 전부 Phase 10에서 해소:

1. **원소 자신의 필드에 atom 없음**: `sales.vendor`는 plain string이라 구독 불가 → 헤더와
   모델 패널은 플랫폼 MutationObserver로 우회.
2. **atom 간 조합 없음**: 재고 가치(price × quantity), 가격 범위(min + max) → 데모 `combine` 헬퍼.
   nanostores `computed` 영역이지만 최소 get/subscribe shape와의 호환은 미확인.
3. **행/셀 분리 비용**: collection `subscribe`는 멤버십/순서만 알리므로 셀 갱신에 필드별 Column
   구독 6개가 필요. 동작하지만 장황함.
4. **외부 상태를 읽는 함수 predicate가 조용히 틀린다**: identity 공유 + DOM 전용 memo 때문에
   `state.search`를 읽는 predicate를 끌어올리면 옛 결과가 계속 나온다. 상태마다 새 함수 필요.
   문서화만 됨 — dev 경고나 API 차원 해법 검토 가치 있음.
5. `$push`는 attribute만 써서 `<note>` 같은 child text 필드를 만들 수 없다 (추가 폼에서 note 제외).

## Phase 10: API 공백 5가지 해소 — **완료** (`pnpm test` 66/66, `test/atoms.test.ts`)

| 공백                   | 결정                                                              | 근거                                                               |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. 원소 필드 atom      | `element.$.field` → `ReadableAtom` (child collection은 자기 자신) | Vue `toRefs`: 같은 모양, atom 값                                   |
| 3. 행/셀 구독          | wrapped element 자체가 atom — subtree 변경 시 자기 자신을 emit    | 노드별 listener 인덱스로 행 N개 구독도 자기 행 변경에만 깨어남     |
| 2. atom 조합           | `computed(atoms, fn)` export, 같은 tick 변경은 1회 emit           | nanostores `computed` 모양 (nanostores 자체는 호환 불가 — 위 정정) |
| 4. 외부 상태 predicate | 함수 `$where(fn, deps)` / `$sort(cmp, deps)`                      | React deps, Svelte `derived(stores)`                               |
| 5. child text 쓰기     | schema `'<string>'` = child element 저장                          | schema가 이미 타입·변환의 단일 진실                                |

deps 설계:

- memo 유효 조건 = DOM version 동일 **그리고** 모든 dep의 `get()`이 `Object.is`로 동일. pull 기반이라
  아무도 구독 안 해도 held view가 정확하다.
- 구독 시 dep도 구독(첫 즉시 호출은 변경 아님으로 무시). deps는 경로를 따라 **누적 상속** —
  하위 `$sort`, 열, 집계, `$deep`까지.
- 캐시: 함수 identity + deps identity가 모두 같을 때만 공유.
- 필터 상태도 DOM(`<filters>`)에 두고 `filters.$.dept`를 dep으로 — source of truth 규율이 UI
  상태까지 확장됨. 데모는 뷰 재생성 코드가 사라지고 **뷰 하나가 페이지 수명 동안** 유지.

데모 재작성: MutationObserver 우회, `combine` 헬퍼, 필드별 Column 구독 6개, 필터 변경 시 뷰
재마운트 전부 제거. 헤드리스 Chromium을 DevTools 프로토콜로 조작해 필터/정렬/편집 후 재정렬/
검색/외부 쓰기/JSX import가 실제 브라우저에서 올바른 값을 내는 것 확인.

## Phase 11: deps 누락 탐지 — **완료** (`pnpm test` 74/74, `test/dev.test.ts`)

탐지 가능한 것부터 갈랐다. 두 층이 서로 다른 것을 잡는다:

1. **정적 (계산 시점)**: 사용자 함수(`$where(fn)`/`$sort(fn)`) 실행 중 e5x proxy를 통한 필드 읽기를
   기록. 읽은 원소가 뷰 트리 밖이고 어떤 dep도 덮지 않으면 즉시 경고 — 위치(`<filters>.min`)와
   함수 이름까지. dep 커버리지는 atom→(node, field) 등록부로 판정: 필드 atom은 그 필드만, 원소 atom·
   collection은 그 subtree 전체를 덮는다. 상태가 바뀌기 **전에** 잡지만 proxy 밖 읽기는 못 본다.
2. **동적 (캐시 적중 시점)**: 틱당 최대 1회 재계산해 캐시와 비교. DOM·deps 변화 없이 결과가 다르면
   = 보이지 않는 입력을 읽었다는 증거. 클로저·외부 store·`Date.now`까지 전부 잡지만 상태가 실제로
   바뀐 뒤 누군가 읽어야 발화. 오탐 없음(비결정적 함수는 경고가 맞다).
   - 하위 캐시(열·집계)는 적중 시 상위 compute를 안 부르므로, 체크 함수를 deps처럼 경로를 따라
     내려보낸다 (`Inputs = { deps, checks }`).
   - 같은 틱에 방금 계산했으면 검증 생략 → 읽기 루프 성능·호출 횟수 테스트 불변.

dev 판정: `try { process.env.NODE_ENV !== 'production' } catch { true }`. **`typeof process` 가드는
쓰면 안 된다** — 번들러가 `NODE_ENV`를 치환해도 브라우저엔 `process`가 없어 production 번들에서 dev가
켜진다(구현 중 dist를 치환 시뮬레이션해서 발견). 치환 결과로 prod=false/dev=true/미치환=true 확인.

검증: 데모 테스트에 "경고 0회" 가드 추가. 실제 Chromium(Vite dev)에서 데모 조작 시 경고 없음, deps를
빠뜨린 뷰는 두 경고 모두 발화.

선택하지 않은 대안: 정적 추적 결과로 **자동 deps**(signals식 암묵 추적). Phase 10에서 명시적 deps를
택했으므로 경고에 머묾. 자동화는 별도 결정.

## 데모 배포 (GitHub Pages)

- https://cbcruk.github.io/e5x/ — `.github/workflows/ci.yml`(PR과 main push에서 검사)이 main에서
  **성공한 뒤에만** `pages.yml`이 `pnpm build:demo`(`vite.demo.config.ts`, 출력 `demo-dist/`) → Pages
  배포(`workflow_run`). 검사가 깨지면 배포 안 됨.
- 라이브러리 빌드(`vite.config.ts`)와 설정 분리. `base: './'`라 서브패스(`/e5x/`)에서 동작.
- Vite 앱 빌드가 `process.env.NODE_ENV`를 치환해 배포본에선 dev 체크가 제거됨(번들에 `process` 0회).
- CI 재현성을 위해 `packageManager: pnpm@11.22.0` 고정.

## 툴체인: Vite+ (2026-09)

- `vite-plus` 0.3.1 — `vp`가 Vite 8(Rolldown) / Vitest 4.1 / Oxlint / Oxfmt / tsdown을 묶는다.
  `vite`는 pnpm catalog + overrides로 `@voidzero-dev/vite-plus-core`에 별칭. import는 `vite-plus`,
  `vite-plus/test`.
- **0.3.2가 아니라 0.3.1인 이유**: pnpm 11은 최소 릴리스 경과 시간보다 새 패키지를 설치하면
  `minimumReleaseAgeExclude`를 **자동으로** 추가한다(비엄격 모드). 공급망 보호를 우회하지 않으려고
  경과 시간을 넘긴 버전을 고정. 올릴 때도 exclude가 생기지 않았는지 확인할 것.
- JSX pragma는 `esbuild` → `oxc.jsx: { runtime: 'classic', pragma, pragmaFrag }` (Vite 8).
- 라이브러리 빌드는 아직 Vite lib mode + vite-plugin-dts. `vp pack`(tsdown) 전환은 #3에서 결정.
- `vp check`는 tsc를 대체하지 않는다(타입 검사는 oxlint type-aware 옵션일 때만). `tsc --noEmit` 유지.
- CI는 `voidzero-dev/setup-vp`(정확한 태그 고정 — 이동 태그 `v1`은 v1.15.0에서 동결됨).
- 포맷: Oxfmt `semi: false`, `singleQuote`, `printWidth: 100` (`vite.config.ts`의 `fmt`). 일괄 포맷
  커밋은 `.git-blame-ignore-revs`에 등록. 포맷 전후 데모 번들 해시가 동일해 동작 무변경을 확인했다.
- 문서: `.claude/rules/jsdoc.md` 규칙. 공개 API + `src/`의 모든 내부 export(인터페이스 멤버 포함)에 JSDoc.
  예제와 `@module`은 공개 API만. `pnpm docs:check`(`scripts/doccheck.ts`)가 JSDoc 누락,
  엔트리 `@module` 누락을 잡고 모든 예제를 `e5x`/`e5x/jsx` import 모듈로 타입 체크한다. CI에서 실행.
- 린트: `vp check`(Oxfmt + Oxlint)가 CI에서 tsc 앞에 돈다. `unicorn/no-useless-spread`는
  `reactive.ts`의 listener 스냅숏에서 **오탐** — 그 자리만 disable. 이 규칙의 `--fix`를 무심코
  적용하면 순회 중 구독 해제 버그가 생긴다.

## 작업 흐름: 이슈 → PR → 리뷰어 에이전트 (실험, 2026-09~)

```
이슈 → 브랜치(issue-<번호>/<요약>) → 로컬 검사 → 초안 PR(CI 실행)
     → 리뷰어 에이전트 → 결과를 PR 댓글로 기록 → 수정 → 재리뷰(최대 2회)
     → 사용자 확인 → squash 머지(`Closes #N`로 이슈 닫힘, 브랜치 삭제)
```

- **리뷰어**: `.claude/agents/reviewer.md`. 새 맥락으로 띄운다(작성자의 판단 과정을 넘기지 않음).
  읽기·명령 실행만 하고 수정·git 상태 변경·GitHub 쓰기는 금지. 이슈의 완료 조건, 동작 오류, 프로젝트
  규칙, 테스트 충분성을 본다. 지적은 must-fix / suggestion으로 나누고, suggestion은 이유를 적고 받지
  않을 수 있다. 재리뷰 2회 후에도 남는 이견은 사용자에게.
- **머지**: 실험 기간에는 매번 사용자 확인 후. 기본 squash, 일부러 나눈 커밋이 있을 때만 rebase.
- **PR 한 번에 하나**: 워크플로·빌드 설정을 건드리는 이슈끼리 충돌하므로 순서대로.
- GitHub은 자기 PR 승인을 막으므로 리뷰 결과는 댓글로 남긴다.

### 실험 기록

리뷰어를 계속 쓸지 #1~#4를 마친 뒤 이 표로 판단한다.

| PR  | 이슈 | 지적(must-fix / suggestion) | 반영 | 오탐 | 리뷰 횟수 | 비고 |
| --- | ---- | --------------------------- | ---- | ---- | --------- | ---- |

## 알려진 약점 (정직하게)

- bulk write read/write 비대칭 → typed에선 iteration 강제.
- `$deep()` 결과는 항상 loose (descendant는 schema에 없음). 의도된 한계.
- descriptor의 child는 1-tuple만 — heterogeneous children 미지원.
- 필드 이름 `get`/`subscribe`는 schema에서 금지, loose 모드에선 collection 레벨 열로 접근 불가
  (atom 프로토콜과 맞바꾼 비용).
- inline arrow predicate/comparator는 매번 새 함수라 뷰 공유 불가 — 공유하려면 함수를 끌어올릴 것.
- 크기: sub-kB 미학에서 멀어지는 중 (gzip 4.96kB). 캐시 계층 + Phase 10 API + dev 체크.
  dev 체크는 런타임 플래그라 production 번들에서도 코드는 남는다(비활성).
- deps 누락은 dev에서만, best-effort로 탐지: proxy 밖 읽기는 상태가 바뀐 뒤 읽힐 때만, 구독만 하고
  읽지 않는 뷰는 못 잡음. 같은 틱에 계산→외부 변경→읽기도 놓침.
- 배열 값 atom(Column 등)을 dep으로 쓰면 `get()`이 매번 새 배열이라 memo가 무력화 (정확성은 유지).
- 원소 atom은 거칠다: `sales.subscribe`는 어떤 item이 바뀌어도 발화. 세밀함은 `$.field`로.
- typed collection의 index signature는 **writable** (결정 2026-09): TS는 `delete`만 허용하고
  대입을 막는 방법이 없다(readonly는 둘 다 막음). E4X식 `delete sales.item[0]` 대칭을 택함.
  구멍: `c[0] = otherRow`(wrapped 원소)는 타입 통과 후 런타임 TypeError. 일반 객체 대입은 타입 에러.
  대입을 element 교체로 의미 부여하는 안은 보류(복사 vs 이동 의미론 미결).
- JSX spike의 `h`는 전역 `document` 의존(SSR 불가) + 전역 `JSX` 네임스페이스 선언
  (React와 충돌 가능). spike 한정.

## 다음 후보

- 패키징(.d.ts, exports map, vite-plugin-dts) → npm publish 여부 결정
- E4X 연산자 문법 커스텀 파서 (진짜 transpiler) — 큰 결정, 수요 확인 후
- 대량 데이터 인덱싱 (selector→set 역색인) — 실측 병목 나오면
