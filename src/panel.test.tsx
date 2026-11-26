// 패널 상호작용 테스트. mockHost 의 requests 가 worker 를 대신한다.
import { afterEach, assert, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panel from './panel'
import type { ExplorerRoot } from './types'

const WS = '/work/repo'
const DL = '/Users/me/Downloads'
const ROOTS: ExplorerRoot[] = [
  { id: 'ws:w1', kind: 'workspace', label: 'main', group: 'Repo', path: WS, workspaceId: 'w1', branch: 'main' },
  { id: 'ws:w2', kind: 'workspace', label: 'box', group: 'Srv', path: '/srv', workspaceId: 'w2', disabled: true, reason: '원격 미지원' }
]
const ROOT_KEY = `ws:w1\u0000${WS}`
const SRC_KEY = `ws:w1\u0000${WS}/src`
const FILE_KEY = `ws:w1\u0000${WS}/src/a.ts`
const TREE = { label: '파일 트리' }

type Calls = { name: string; input: any }[]

function listing(path: string) {
  if (path === WS) return [{ name: 'src', path: `${WS}/src`, dir: true }, { name: 'README.md', path: `${WS}/README.md`, dir: false }]
  if (path === `${WS}/src`) return [{ name: 'a.ts', path: `${WS}/src/a.ts`, dir: false }]
  if (path === DL) return [{ name: 'photos', path: `${DL}/photos`, dir: true }, { name: 'memo.txt', path: `${DL}/memo.txt`, dir: false }]
  if (path === '/Users/me') return [{ name: 'Downloads', path: DL, dir: true }]
  return []
}

function fakeWorker(calls: Calls, overrides: Record<string, (input: any) => unknown> = {}) {
  const base: Record<string, (input: any) => unknown> = {
    'roots.list': () => ({ roots: ROOTS }),
    'fs.list': ({ path }) => ({ entries: listing(path), truncated: path === `${WS}/src` ? 3 : 0 }),
    'fs.resolveDir': ({ path }) => ({ path: path.replace(/^~/, '/Users/me') }),
    'fs.open': ({ rootId }) => (rootId.startsWith('loc:') ? { opened: true, registered: DL } : { opened: true }),
    'fs.search': () => ({ hits: [{ rootId: 'ws:w1', path: `${WS}/src/a.ts`, rel: 'src/a.ts', dir: false }], truncated: false }),
    'fs.create': ({ dir, name }) => ({ path: `${dir}/${name}` }),
    'fs.rename': ({ path, newName }) => ({ path: `${path.slice(0, path.lastIndexOf('/'))}/${newName}` }),
    'fs.delete': ({ path }) => ({ trashedTo: `/Users/me/.Trash/${path.split('/').pop()}` }),
    'roots.remove': ({ id }) => ({ roots: ROOTS.filter((r) => r.id !== id) }),
    'roots.add': ({ path }) => ({
      roots: [...ROOTS, { id: `p:${path}`, kind: 'custom', label: path, group: '내 경로', path }],
      added: `p:${path}`
    })
  }
  const all = { ...base, ...overrides }
  return Object.fromEntries(
    Object.entries(all).map(([name, fn]) => [name, (input: unknown) => (calls.push({ name, input }), fn(input))])
  )
}

let view: TestPanel | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

async function open(calls: Calls, overrides = {}, persisted?: Record<string, unknown>) {
  view = await mount(panel, { host: mockHost({ requests: fakeWorker(calls, overrides) as never }), persisted: { plugin: persisted } })
  return view
}

const last = (calls: Calls, name: string) => calls.filter((c) => c.name === name).at(-1)?.input

test('파일을 한 번 클릭하면 미리보기 없이 Orca 탭으로 연다', async () => {
  const calls: Calls = []
  const v = await open(calls)
  await v.expand(TREE, ROOT_KEY)
  await v.expand(TREE, SRC_KEY)
  assert.ok(v.find({ text: /3개 더/ }), '잘린 항목 수를 보여준다')
  await v.selectItem(TREE, FILE_KEY)
  assert.deepEqual(last(calls, 'fs.open'), { rootId: 'ws:w1', path: `${WS}/src/a.ts` })
  assert.equal(v.find({ label: '미리보기' }), null)
  assert.ok(!calls.some((c) => c.name === 'fs.preview'))
  // 폴더 클릭은 열지 않고 선택만 한다.
  const opens = calls.filter((c) => c.name === 'fs.open').length
  await v.selectItem(TREE, SRC_KEY)
  assert.equal(calls.filter((c) => c.name === 'fs.open').length, opens)
  assert.deepEqual(v.errors, [])
  assert.deepEqual(v.refusals, [])
})

test('Finder 처럼: 경로 입력으로 이동, 그 폴더만 보이고, 상위·전체로 돌아간다', async () => {
  const calls: Calls = []
  const v = await open(calls)
  await v.type({ label: '위치' }, '~/Downloads', { submit: true })
  assert.deepEqual(last(calls, 'fs.resolveDir'), { path: '~/Downloads' })
  assert.deepEqual(last(calls, 'fs.list'), { rootId: `loc:${DL}`, path: DL })
  assert.equal(v.valueOf({ label: '위치' }), DL)
  assert.match(v.summary().join('\n'), /Tree "파일 트리": 2 top-level/)
  assert.deepEqual(v.persisted.plugin.location, DL)

  // 바깥 파일 클릭 → 탭으로 열고, 폴더를 프로젝트로 등록했다고 알린다.
  await v.selectItem(TREE, `loc:${DL}\u0000${DL}/memo.txt`)
  assert.deepEqual(last(calls, 'fs.open'), { rootId: `loc:${DL}`, path: `${DL}/memo.txt` })
  assert.ok(v.find({ text: /Orca 프로젝트로 등록해 탭으로 열었습니다/ }))

  // 더블클릭한 폴더로 들어간다.
  await v.activateItem(TREE, `loc:${DL}\u0000${DL}/photos`)
  assert.equal(v.valueOf({ label: '위치' }), `${DL}/photos`)

  await v.press({ label: '상위 폴더' })
  await v.press({ label: '상위 폴더' })
  assert.equal(v.valueOf({ label: '위치' }), '/Users/me')

  await v.press({ label: '모든 워크스페이스' })
  assert.equal(v.valueOf({ label: '위치' }), '')
  assert.match(v.summary().join('\n'), /Tree "파일 트리": 2 top-level/) // 그룹 2개
  assert.deepEqual(v.errors, [])
})

test('워크스페이스 트리에서 폴더를 더블클릭하면 그 폴더 위치로 이동', async () => {
  const calls: Calls = []
  const v = await open(calls)
  await v.expand(TREE, ROOT_KEY)
  await v.activateItem(TREE, SRC_KEY)
  assert.equal(v.valueOf({ label: '위치' }), `${WS}/src`)
  assert.deepEqual(last(calls, 'fs.list'), { rootId: `loc:${WS}/src`, path: `${WS}/src` })
})

test('별 버튼으로 즐겨찾기 넣고 빼기, 드롭다운으로 이동', async () => {
  const calls: Calls = []
  const v = await open(calls, {}, { location: DL })
  assert.deepEqual(last(calls, 'fs.list'), { rootId: `loc:${DL}`, path: DL })
  assert.equal(v.find({ label: '즐겨찾기' }), null, '즐겨찾기가 없으면 드롭다운도 없다')

  await v.press({ label: '즐겨찾기에 추가' })
  assert.deepEqual(last(calls, 'roots.add'), { path: DL })
  assert.equal(v.valueOf({ label: '즐겨찾기' }), DL, '현재 위치가 즐겨찾기면 드롭다운에 표시')

  // 다른 곳으로 갔다가 드롭다운으로 돌아온다.
  await v.press({ label: '모든 워크스페이스' })
  assert.equal(v.valueOf({ label: '즐겨찾기' }), '')
  await v.select({ label: '즐겨찾기' }, DL)
  assert.equal(v.valueOf({ label: '위치' }), DL)

  // 다시 누르면 뺀다.
  await v.press({ label: '즐겨찾기에서 빼기' })
  assert.deepEqual(last(calls, 'roots.remove'), { id: `p:${DL}` })
  assert.equal(v.find({ label: '즐겨찾기' }), null)
  assert.deepEqual(v.errors, [])
  assert.deepEqual(v.warnings, [])
})

test('위치에서 아무것도 안 고르고 새 파일 → 이름 변경 → 휴지통', async () => {
  const calls: Calls = []
  const v = await open(calls, {}, { location: DL })
  await v.press({ label: '새 파일' })
  await v.type({ label: '새 파일 이름' }, 'b.txt', { submit: true })
  assert.deepEqual(last(calls, 'fs.create'), { rootId: `loc:${DL}`, dir: DL, name: 'b.txt', kind: 'file' })
  assert.ok(v.find({ text: /파일을 만들었습니다/ }))
  assert.deepEqual(last(calls, 'fs.open'), { rootId: `loc:${DL}`, path: `${DL}/b.txt` }, '만든 파일을 탭으로 연다')

  await v.press({ label: '이름 변경' })
  assert.equal(v.valueOf({ label: '새 이름' }), 'b.txt')
  await v.type({ label: '새 이름' }, 'c.txt', { replace: true, submit: true })
  assert.deepEqual(last(calls, 'fs.rename'), { rootId: `loc:${DL}`, path: `${DL}/b.txt`, newName: 'c.txt' })

  await v.press({ label: '삭제' })
  assert.ok(v.findAll({ type: 'Callout' }).some((c) => c.props.title === '휴지통으로 옮길까요?'))
  await v.press({ text: '휴지통으로 이동' })
  assert.deepEqual(last(calls, 'fs.delete'), { rootId: `loc:${DL}`, path: `${DL}/c.txt` })
  assert.ok(v.find({ text: /휴지통으로 옮겼습니다/ }))
  assert.deepEqual(v.errors, [])
})

test('검색 결과 파일을 누르면 탭으로 열고, 위치 모드에선 위치 안에서만 찾는다', async () => {
  const calls: Calls = []
  const v = await open(calls)
  await v.type({ label: '파일 검색' }, 'a.ts', { submit: true })
  assert.deepEqual(last(calls, 'fs.search'), { query: 'a.ts' })
  await v.press({ type: 'ListItem', label: 'a.ts' })
  assert.deepEqual(last(calls, 'fs.open'), { rootId: 'ws:w1', path: `${WS}/src/a.ts` })

  await v.press({ label: '검색 지우기' })
  await v.type({ label: '위치' }, DL, { submit: true })
  await v.type({ label: '파일 검색' }, 'memo', { submit: true })
  assert.deepEqual(last(calls, 'fs.search'), { query: 'memo', rootId: `loc:${DL}` })
})

test('열기 실패와 worker 의 fs.changed', async () => {
  const calls: Calls = []
  const v = await open(calls, {
    'fs.open': () => {
      throw new Error('너무 넓어서 Orca 프로젝트로 등록하지 않습니다.')
    }
  })
  await v.expand(TREE, ROOT_KEY)
  await v.selectItem(TREE, `ws:w1\u0000${WS}/README.md`)
  assert.ok(v.find({ text: /너무 넓어서/ }))
  const before = calls.filter((c) => c.name === 'fs.list').length
  await v.post('fs.changed', { rootId: 'ws:w1', dirs: [WS] })
  assert.equal(calls.filter((c) => c.name === 'fs.list').length, before + 1)
})
