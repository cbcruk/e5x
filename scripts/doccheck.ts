/**
 * Checks the JSDoc of the package: the public API of both entry points and every internal export.
 *
 * Fails when an entry file lacks a `@module` comment; when a symbol reachable from an entry point
 * (exports, plus interfaces those types are built from, and their members) or any module-level
 * export under `src/` (and the members of exported interfaces) has no JSDoc block; or when a code
 * block in the public documentation does not type-check as its own module importing from
 * `e5x` / `e5x/jsx`. Internal documentation is not scanned for examples, because internal
 * modules cannot be imported by the package name. `docs/API.md` must have a `###` section, with a
 * `**Type:**` line and an example, for every export and every `$` member, and its examples are
 * type-checked too; the text of **Type:** lines is not verified. Run with `pnpm docs:check`.
 *
 * @module
 */
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
const entries: Record<string, string> = {
  e5x: path.join(root, 'src/index.ts'),
  'e5x/jsx': path.join(root, 'src/jsx.ts'),
}

const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile).config
const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root)
const program = ts.createProgram(Object.values(entries), { ...options, noEmit: true })
const checker = program.getTypeChecker()

const problems: string[] = []
const examples: { code: string; lang: string; where: string }[] = []
let documented = 0

function where(node: ts.Node): string {
  const sf = node.getSourceFile()
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
  return `${path.relative(root, sf.fileName)}:${line + 1}`
}

function collectExamples(comment: string, at: string, markdown = false): void {
  // JSDoc bodies lose their leading ` * `; Markdown files are taken as they are.
  const body = markdown ? comment : comment.replace(/^\s*\/?\*+\/?[ ]?/gm, '')
  for (const match of body.matchAll(/```(tsx?)\n([\s\S]*?)```/g)) {
    examples.push({ lang: match[1]!, code: match[2]!, where: at })
  }
}

const checked = new Set<ts.Node>()

function requireDoc(node: ts.Node, name: string, publicApi: boolean): void {
  if (checked.has(node)) return
  checked.add(node)
  const docs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc)
  if (docs.length === 0) {
    problems.push(`${where(node)}  ${name}: missing JSDoc`)
    return
  }
  documented += 1
  if (!publicApi) return
  for (const doc of docs) {
    collectExamples(doc.getFullText(), `${where(node)} ${name}`)
  }
}

function isPackageSource(node: ts.Node): boolean {
  const file = node.getSourceFile().fileName
  return file.startsWith(path.join(root, 'src'))
}

// Interfaces surface through type aliases (`Collection<N> = CollectionBase<N> & …`), so follow
// type references inside alias bodies to the interfaces declared in the package.
// Interface declaration → whether it belongs to the public API (whose examples are checked).
const interfaces = new Map<ts.InterfaceDeclaration, boolean>()
const visitedAliases = new Set<ts.TypeAliasDeclaration>()

function followTypes(node: ts.Node): void {
  if (ts.isTypeReferenceNode(node)) {
    let symbol = checker.getSymbolAtLocation(node.typeName)
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    for (const decl of symbol?.declarations ?? []) {
      if (!isPackageSource(decl)) continue
      if (ts.isInterfaceDeclaration(decl)) interfaces.set(decl, true)
      if (ts.isTypeAliasDeclaration(decl) && !visitedAliases.has(decl)) {
        visitedAliases.add(decl)
        followTypes(decl.type)
      }
    }
  }
  ts.forEachChild(node, followTypes)
}

for (const [specifier, file] of Object.entries(entries)) {
  const sf = program.getSourceFile(file)!
  const head = ts.getLeadingCommentRanges(sf.text, 0)?.find((range) => {
    const text = sf.text.slice(range.pos, range.end)
    return text.startsWith('/**') && /@module\b/.test(text)
  })
  if (head) {
    collectExamples(sf.text.slice(head.pos, head.end), `${path.relative(root, file)} @module`)
  } else {
    problems.push(`${path.relative(root, file)}:1  ${specifier}: missing @module comment`)
  }

  for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(sf)!)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const declarations = symbol.declarations ?? []
    for (const decl of declarations) {
      // Overloads carry the docs; the implementation signature is not visible to callers.
      if (ts.isFunctionDeclaration(decl) && decl.body && declarations.length > 1) continue
      requireDoc(decl, `${specifier} ${exported.name}`, true)
      if (ts.isInterfaceDeclaration(decl)) interfaces.set(decl, true)
      if (ts.isTypeAliasDeclaration(decl)) followTypes(decl.type)
    }
  }
}

// Internal modules: every module-level export is documented too, so maintainers get the same
// tooltips. Overload implementations are skipped, as for the public API.
function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  )
}

for (const sf of program.getSourceFiles()) {
  if (!sf.fileName.startsWith(path.join(root, 'src') + path.sep)) continue
  const file = path.relative(root, sf.fileName)
  for (const statement of sf.statements) {
    if (!isExported(statement)) continue
    if (ts.isVariableStatement(statement)) {
      const names = statement.declarationList.declarations.map((d) => d.name.getText())
      requireDoc(statement, `${file} ${names.join(', ')}`, false)
      continue
    }
    if (
      !ts.isFunctionDeclaration(statement) &&
      !ts.isInterfaceDeclaration(statement) &&
      !ts.isTypeAliasDeclaration(statement) &&
      !ts.isClassDeclaration(statement)
    ) {
      continue
    }
    const name = statement.name?.text ?? 'default'
    if (ts.isFunctionDeclaration(statement) && statement.body && statement.name) {
      const overloads = checker.getSymbolAtLocation(statement.name)?.declarations ?? []
      if (overloads.length > 1) continue
    }
    requireDoc(statement, `${file} ${name}`, false)
    if (ts.isInterfaceDeclaration(statement) && !interfaces.has(statement)) {
      interfaces.set(statement, false)
    }
  }
}

for (const [decl, publicApi] of interfaces) {
  const name = decl.name.text
  requireDoc(decl, name, publicApi)
  for (const member of decl.members) {
    const memberName = member.name
      ? member.name.getText()
      : `[${member.kind === ts.SyntaxKind.IndexSignature ? 'index' : 'call'}]`
    requireDoc(member, `${name}.${memberName}`, publicApi)
  }
}

// The API reference (docs/API.md) is checked against the same declarations: every export and
// every `$` member needs a `###` section whose heading names it in backticks (`wrap(...)`,
// `collection.$where(...)`), with a `**Type:**` line and at least one example. Its examples are
// type-checked with the JSDoc ones. The text of a **Type:** line is not compared with the
// declaration; keep it in step by hand.
const reference = path.join(root, 'docs/API.md')
// Which prefix a `$` member is documented under, by the interface that declares or inherits it.
const memberPrefixes: Record<string, string> = {
  WrappedBase: 'element',
  ElementAtom: 'element',
  LooseWrapped: 'element',
  CollectionBase: 'collection',
  LooseCollection: 'collection',
  Column: 'column',
}
const required = new Set<string>()
for (const file of Object.values(entries)) {
  const sf = program.getSourceFile(file)!
  for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(sf)!)) {
    required.add(exported.name)
  }
}
// Members are read through the type, so ones inherited from a base interface count, and every
// `$` member declared in the package must be reached this way: a renamed interface or a member
// moved elsewhere fails the check instead of dropping out of it.
const covered = new Set<ts.Node>()
for (const [name, prefix] of Object.entries(memberPrefixes)) {
  const decl = [...interfaces.keys()].find((candidate) => candidate.name.text === name)
  if (!decl) {
    problems.push(`scripts/doccheck.ts: no public interface named ${name} to take $ members from`)
    continue
  }
  for (const property of checker.getPropertiesOfType(checker.getTypeAtLocation(decl))) {
    if (!property.name.startsWith('$')) continue
    required.add(`${prefix}.${property.name}`)
    for (const declaration of property.declarations ?? []) covered.add(declaration)
  }
}
for (const sf of program.getSourceFiles()) {
  if (!sf.fileName.startsWith(path.join(root, 'src') + path.sep)) continue
  ts.forEachChild(sf, function visit(node) {
    if (ts.isInterfaceDeclaration(node)) {
      for (const member of node.members) {
        if (member.name?.getText().startsWith('$') && !covered.has(member)) {
          problems.push(
            `${where(member)}  ${node.name.text}.${member.name.getText()}: $ member not covered by the ` +
              'API reference check; add its interface to memberPrefixes',
          )
        }
      }
    }
    ts.forEachChild(node, visit)
  })
}

if (!ts.sys.fileExists(reference)) {
  problems.push('docs/API.md: missing')
} else {
  const text = ts.sys.readFile(reference)!
  const sections = new Map<string, { body: string; line: number }[]>()
  const lines = text.split('\n')
  let current: { keys: string[]; body: string[]; line: number } | null = null
  const flush = (): void => {
    if (!current) return
    for (const key of current.keys) {
      const list = sections.get(key) ?? []
      list.push({ body: current.body.join('\n'), line: current.line })
      sections.set(key, list)
    }
  }
  lines.forEach((line, i) => {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      // Only `###` headings are entries; a mention in any other heading does not count.
      const keys =
        heading[1] === '###'
          ? [...heading[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.split(/[(<\s]/)[0]!)
          : []
      current = { keys, body: [], line: i + 1 }
    } else {
      current?.body.push(line)
    }
  })
  flush()
  for (const key of required) {
    const found = sections.get(key)
    if (!found) {
      problems.push(`docs/API.md: no section for \`${key}\``)
      continue
    }
    for (const { body, line } of found) {
      if (!/\*\*Type:\*\*/.test(body))
        problems.push(`docs/API.md:${line}  ${key}: no **Type:** line`)
      if (!/```tsx?\n/.test(body)) problems.push(`docs/API.md:${line}  ${key}: no example`)
    }
  }
  collectExamples(text, 'docs/API.md', true)
}

// Type-check every example as its own module, resolving the package name to the sources.
const virtual = new Map<string, { code: string; where: string }>()
examples.forEach((example, i) => {
  if (!/^import\s/m.test(example.code)) {
    problems.push(`${example.where}: example ${i + 1} has no import statement`)
  }
  virtual.set(path.join(root, '.doccheck', `example-${i + 1}.${example.lang}`), example)
})

const exampleOptions: ts.CompilerOptions = {
  ...options,
  noEmit: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  baseUrl: root,
  paths: { e5x: [entries.e5x!], 'e5x/jsx': [entries['e5x/jsx']!] },
}
const host = ts.createCompilerHost(exampleOptions)
const { fileExists, readFile, getSourceFile } = host
host.fileExists = (file) => virtual.has(file) || fileExists(file)
host.readFile = (file) => virtual.get(file)?.code ?? readFile(file)
host.getSourceFile = (file, language, ...rest) => {
  const example = virtual.get(file)
  return example
    ? ts.createSourceFile(file, example.code, language, true)
    : getSourceFile(file, language, ...rest)
}
const exampleProgram = ts.createProgram([...virtual.keys()], exampleOptions, host)
for (const diagnostic of ts.getPreEmitDiagnostics(exampleProgram)) {
  const example = diagnostic.file && virtual.get(diagnostic.file.fileName)
  if (!example) continue
  const { line } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
  problems.push(`${example.where}: example line ${line + 1}: ${message}`)
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error(`\ndocs:check failed: ${problems.length} problem(s)`)
  process.exit(1)
}
console.log(`docs:check passed: ${documented} documented declarations, ${examples.length} examples`)
