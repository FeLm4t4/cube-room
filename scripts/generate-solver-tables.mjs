import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const packageFile = require.resolve('min2phase.js/package.json')
const packageRoot = new URL('./', pathToFileURL(packageFile))
const packageInfo = JSON.parse(await readFile(packageFile, 'utf8'))
if (packageInfo.version !== '0.0.4') throw new Error('生成元は min2phase.js 0.0.4 に固定してください。')

const original = await readFile(new URL('min2phase.js', packageRoot), 'utf8')
const source = original.replaceAll('\r\n', '\n')
const sourceHash = createHash('sha256').update(original).digest('hex')
const readme = await readFile(new URL('README.md', packageRoot), 'utf8')
const mit = readme.slice(readme.indexOf('# License MIT') + '# License MIT'.length).trim()
  .split(/\r?\n/).map((line) => line.replace(/^ {4}/, '')).join('\n')
if (!mit.includes('Permission is hereby granted')) throw new Error('生成元の MIT 許諾文を確認できません。')

function replaceOnce(text, before, after) {
  if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before)) {
    throw new Error(`生成元の構造が変わっています: ${before.slice(0, 65)}`)
  }
  return text.replace(before, after)
}

const declarations = source.slice(source.indexOf('\tvar moveCube = [];'), source.indexOf('\tvar TwstFlipPrunMax'))
const names = [...declarations.matchAll(/var (\w+) = \[\];/g)].map((match) => match[1]).filter((name) => name !== 'moveCube')
const scalarNames = ['TwstFlipPrunMax', 'SliceTwstPrunMax', 'SliceFlipPrunMax', 'MCPermPrunMax', 'EPermCCombPPrunMax']
const returnMarker = '\treturn {\n\t\tSearch: Search,'
const instrumented = replaceOnce(source, returnMarker,
  `\treturn {\n\t\t_exportTables: function() { return { ${[...names, ...scalarNames].join(', ')} }; },\n\t\tSearch: Search,`)
const context = vm.createContext({ module: { exports: {} } })
new vm.Script(instrumented).runInContext(context)
context.module.exports.initFull()
const tables = context.module.exports._exportTables()

// 先頭 16 byte の識別情報に続けて、整数表を連続配置する。
const values = []
const layout = []
for (const name of names) {
  const value = tables[name]
  const offset = values.length
  if (name === 'SymCube') {
    for (const cube of value) values.push(...cube.ca, ...cube.ea)
    layout.push({ name, offset, length: value.length * 20, kind: 'cubes', rows: value.length })
  } else if (Array.isArray(value[0])) {
    const rows = value.map((row) => row.length)
    for (const row of value) values.push(...row)
    layout.push({ name, offset, length: values.length - offset, kind: 'rows', rows })
  } else {
    for (const item of value) values.push(item)
    layout.push({ name, offset, length: value.length, kind: 'flat' })
  }
}
if (values.some((value) => !Number.isInteger(value))) throw new Error('探索表に整数以外の値が含まれています。')

const binary = Buffer.alloc(16 + values.length * 4)
binary.writeUInt32LE(0x32504352, 0)
binary.writeUInt32LE(1, 4)
binary.writeUInt32LE(values.length, 8)
binary.writeUInt32LE(names.length, 12)
values.forEach((value, index) => binary.writeInt32LE(value, 16 + index * 4))

const assignments = layout.map((entry) => {
  const slice = `data.subarray(${entry.offset}, ${entry.offset + entry.length})`
  if (entry.kind === 'flat') return `\t\t\t${entry.name} = ${slice};`
  if (entry.kind === 'cubes') {
    return `\t\t\t${entry.name} = [];\n\t\t\tfor (var i = 0; i < ${entry.rows}; i++) {\n\t\t\t\tvar base = ${entry.offset} + i * 20;\n\t\t\t\t${entry.name}.push(new CubieCube().init(data.subarray(base, base + 8), data.subarray(base + 8, base + 20)));\n\t\t\t}`
  }
  let offset = entry.offset
  const rows = entry.rows.map((length) => {
    const row = `data.subarray(${offset}, ${offset + length})`
    offset += length
    return row
  })
  return `\t\t\t${entry.name} = [${rows.join(', ')}];`
}).join('\n')

const tableLoader = `
\t\t// 端末上では探索表を生成せず、生成済みの整数配列を参照する。
\t\tloadTables: function(buffer) {
\t\t\tif (buffer.byteLength !== ${binary.length}) throw new Error("探索表のサイズが一致しません。");
\t\t\tvar header = new DataView(buffer);
\t\t\tif (header.getUint32(0, true) !== 0x32504352 || header.getUint32(4, true) !== 1 || header.getUint32(8, true) !== ${values.length} || header.getUint32(12, true) !== ${names.length}) throw new Error("探索表の形式が一致しません。");
\t\t\tvar data = new Int32Array(buffer, 16);
${assignments}
${scalarNames.map((name) => `\t\t\t${name} = ${tables[name]};`).join('\n')}
\t\t\tInitPrunProgress = 54;
\t\t\tPARTIAL_INIT_LEVEL = 0;
\t\t},`

let vendor = replaceOnce(source, returnMarker, `\treturn {${tableLoader}\n\t\tSearch: Search,`)
const budgetSupport = `
\t// probe の上限だけでは止まらない枝も、再帰中に時計を確認して中断する。
\tfunction checkBudget(search) {
\t\tif (((search._budgetNodes++ & 1023) === 0) && search._shouldStop && search._shouldStop()) {
\t\t\tvar error = new Error("探索を中断しました。");
\t\t\terror.name = "SearchInterrupted";
\t\t\tthrow error;
\t\t}
\t}
\tSearch.prototype.setControl = function(shouldStop, sliceUntil) {
\t\tthis._shouldStop = shouldStop;
\t\tthis._sliceUntil = sliceUntil;
\t\tthis._budgetNodes = 0;
\t};
`
vendor = replaceOnce(vendor, '\tSearch.prototype.solution = function(', `${budgetSupport}\n\tSearch.prototype.solution = function(`)
for (const signature of [
  'phase1PreMoves = function(maxl, lm, cc)',
  'phase1 = function(node, maxl, lm)',
  'phase2 = function(edge, esym, corn, csym, mid, maxl, depth, lm)',
]) {
  const marker = `\tSearch.prototype.${signature} {`
  vendor = replaceOnce(vendor, marker, `${marker}\n\t\tcheckBudget(this);`)
}
vendor = replaceOnce(vendor,
  '\tSearch.prototype.initPhase2Pre = function() {\n\t\tthis.isRec = false;',
  '\tSearch.prototype.initPhase2Pre = function() {\n\t\tthis.isRec = false;\n\t\tif (this._sliceUntil !== undefined && performance.now() >= this._sliceUntil) return 0;')
const initStart = vendor.indexOf('\tfunction initPrunTables() {')
const initEnd = vendor.indexOf('\n\tfunction randomCube()', initStart)
if (initStart < 0 || initEnd < 0) throw new Error('初期化の置換位置を確認できません。')
vendor = vendor.slice(0, initStart) + `\tfunction initPrunTables() {
\t\tif (InitPrunProgress !== 54) throw new Error("探索表を先に読み込んでください。");
\t\treturn true;
\t}
` + vendor.slice(initEnd)
vendor = vendor.slice(0, vendor.indexOf("\nif (typeof module !== 'undefined'")) + '\nexport default min2phase;\n'
vendor = `/*! min2phase.js 0.0.4 | Copyright (c) 2023 Chen Shuang | MIT\n * Source: https://github.com/cs0x7f/min2phase.js\n * SHA-256: ${sourceHash}\n * ${mit.replaceAll('\n', '\n * ')}\n */\n// scripts/generate-solver-tables.mjs から生成。変更点は探索表の復元、期限確認、ESM 公開のみ。\n${vendor}`
vendor = vendor.replace(/[ \t]+$/gm, '')

const output = new URL('../src/vendor/', import.meta.url)
await mkdir(output, { recursive: true })
await writeFile(new URL('min2phase.js', output), vendor, 'utf8')
await writeFile(new URL('min2phase-tables.bin', output), binary)
await writeFile(new URL('min2phase.MIT-LICENSE.txt', output), `${mit}\n`, 'utf8')
await writeFile(new URL('min2phase-tables.json', output), JSON.stringify({
  package: 'min2phase.js', version: packageInfo.version, sourceSha256: sourceHash,
  binarySha256: createHash('sha256').update(binary).digest('hex'), bytes: binary.length,
  generatedBy: 'node scripts/generate-solver-tables.mjs',
}, null, 2) + '\n', 'utf8')
console.log(`探索表を生成しました: ${fileURLToPath(new URL('min2phase-tables.bin', output))} (${binary.length} bytes)`)
