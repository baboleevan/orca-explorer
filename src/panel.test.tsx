// 패널 상호작용 테스트. mockHost 의 requests 가 worker 를 대신한다.
import { afterEach, assert, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panel from './panel'
import type { ExplorerRoot } from './types'

const WS = '/work/repo'
const ROOTS: ExplorerRoot[] = [
  { id: 'ws:w1', kind: 'workspace', label: 'main', group: 'Repo', path: WS, workspaceId: 'w1', branch: 'main' },
  { id: 'ws:w2', kind: 'workspace', label: 'box', group: 'Srv', path: '/srv', workspaceId: 'w2', disabled: true, reason: '원격 미지원' },
  { id: 'p:/Users/me/Downloads', kind: 'custom', label: '/Users/me/Downloads', group: '내 경로', path: '/Users/me/Downloads' }
]
const ROOT_KEY = `ws:w1\u0000${WS}`
const SRC_KEY = `ws:w1\u0000${WS}/src`
const FILE_KEY = `ws:w1\u0000${WS}/src/a.ts`

type Calls = { name: string; input: unknown }[]

function fakeWorker(calls: Calls, overrides: Record<string, (input: any) => unknown> = {}) {
  const log = (name: string, fn: (input: any) => unknown) => (input: unknown) => {
    calls.push({ name, input })
    return fn(input)
  }
  const base: Record<string, (input: any) => unknown> = {
    'roots.list': () => ({ roots: ROOTS }),
    'fs.list': ({ path }: { path: string }) =>
      path === WS
        ? { entries: [{ name: 'src', path: `${WS}/src`, dir: true }, { name: 'README.md', path: `${WS}/README.md`, dir: false }], truncated: 0 }
        : { entries: [{ name: 'a.ts', path: `${WS}/src/a.ts`, dir: false }], truncated: 3 },
    'fs.preview': ({ path }: { path: string }) => ({ kind: 'text', path, size: 12, text: 'const a = 1', language: 'typescript' }),
    'fs.open': () => ({ opened: true }),
    'fs.search': () => ({ hits: [{ rootId: 'ws:w1', path: `${WS}/src/a.ts`, rel: 'src/a.ts', dir: false }], truncated: false }),
    'fs.create': ({ dir, name }: { dir: string; name: string }) => ({ path: `${dir}/${name}` }),
    'fs.rename': ({ path, newName }: { path: string; newName: string }) => ({ path: `${path.slice(0, path.lastIndexOf('/'))}/${newName}` }),
    'fs.delete': ({ path }: { path: string }) => ({ trashedTo: `/Users/me/.Trash/${path.split('/').pop()}` }),
    'roots.add': ({ path }: { path: string }) => ({ roots: ROOTS, added: `p:${path}` })
  }
  const all = { ...base, ...overrides }
  return Object.fromEntries(Object.entries(all).map(([k, fn]) => [k, log(k, fn)]))
}

let view: TestPanel | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

async function open(calls: Calls, overrides = {}) {
  view = await mount(panel, { host: mockHost({ requests: fakeWorker(calls, overrides) as never }) })
  return view
}

const names = (calls: Calls) => calls.map((c) => c.name)

test('그룹·루트를 그리고, 펼치면 목록을 읽고, 파일을 고르면 미리보기·Enter 로 연다', async () => {
  const calls: Calls = []
  const v = await open(calls)
  const summary = v.summary().join('\n')
  assert.match(summary, /tree/i)

  await v.expand({ label: '파일 트리' }, ROOT_KEY)
  await v.expand({ label: '파일 트리' }, SRC_KEY)
  assert.deepEqual(calls.filter((c) => c.name === 'fs.list').map((c) => (c.input as { path: string }).path), [WS, `${WS}/src`])
  assert.ok(v.find({ text: /3개 더/ }), '잘린 항목 수를 보여준다')

  await v.selectItem({ label: '파일 트리' }, FILE_KEY)
  assert.ok(names(calls).includes('fs.preview'))
  assert.ok(v.find({ label: '미리보기' }))

  await v.activateItem({ label: '파일 트리' }, FILE_KEY)
  assert.deepEqual(calls.at(-1), { name: 'fs.open', input: { rootId: 'ws:w1', path: `${WS}/src/a.ts` } })
  assert.deepEqual(v.persisted.plugin.expanded, [ROOT_KEY, SRC_KEY])
  assert.deepEqual(v.errors, [])
  assert.deepEqual(v.refusals, [])
})

test('검색: Enter 로 찾고 결과를 고르면 미리보기, 트리에서 보기로 조상을 펼친다', async () => {
  const calls: Calls = []
  const v = await open(calls)
  await v.type({ label: '파일 검색' }, 'a.ts', { submit: true })
  assert.ok(v.find({ type: 'ListItem', label: 'a.ts' }))
  await v.press({ type: 'ListItem', label: 'a.ts' })
  assert.ok(names(calls).includes('fs.preview'))

  await v.press({ text: '트리에서 보기' })
  assert.equal(v.valueOf({ label: '파일 검색' }), '')
  assert.ok(v.expandedOf({ label: '파일 트리' }).includes(SRC_KEY))
  assert.deepEqual(v.errors, [])
})

test('새 파일 만들기 → 이름 바꾸기 → 휴지통', async () => {
  const calls: Calls = []
  const v = await open(calls)
  await v.expand({ label: '파일 트리' }, ROOT_KEY)
  await v.selectItem({ label: '파일 트리' }, SRC_KEY)

  await v.press({ label: '새 파일' })
  await v.type({ label: '새 파일 이름' }, 'b.ts', { submit: true })
  assert.deepEqual(calls.find((c) => c.name === 'fs.create')?.input, { rootId: 'ws:w1', dir: `${WS}/src`, name: 'b.ts', kind: 'file' })
  assert.ok(v.find({ text: /파일을 만들었습니다/ }))

  await v.press({ label: '이름 변경' })
  assert.equal(v.valueOf({ label: '새 이름' }), 'b.ts')
  await v.type({ label: '새 이름' }, 'c.ts', { replace: true, submit: true })
  assert.deepEqual(calls.find((c) => c.name === 'fs.rename')?.input, { rootId: 'ws:w1', path: `${WS}/src/b.ts`, newName: 'c.ts' })

  await v.press({ label: '삭제' })
  assert.ok(v.findAll({ type: 'Callout' }).some((c) => c.props.title === '휴지통으로 옮길까요?'))
  await v.press({ text: '휴지통으로 이동' })
  assert.deepEqual(calls.find((c) => c.name === 'fs.delete')?.input, { rootId: 'ws:w1', path: `${WS}/src/c.ts` })
  assert.ok(v.find({ text: /휴지통으로 옮겼습니다/ }))
  assert.deepEqual(v.errors, [])
})

test('경로 추가와 오류 메시지', async () => {
  const calls: Calls = []
  const v = await open(calls, {
    'fs.open': () => {
      throw new Error('워크스페이스 밖의 파일은 Orca 탭으로 열 수 없습니다.')
    }
  })
  await v.press({ label: '경로 추가' })
  await v.type({ label: '폴더 경로' }, '~/Downloads', { submit: true })
  assert.deepEqual(calls.find((c) => c.name === 'roots.add')?.input, { path: '~/Downloads' })
  assert.ok(v.find({ text: /경로를 추가했습니다/ }))

  await v.expand({ label: '파일 트리' }, ROOT_KEY)
  await v.activateItem({ label: '파일 트리' }, `ws:w1\u0000${WS}/README.md`)
  assert.ok(v.find({ text: /Orca 탭으로 열 수 없습니다/ }))
})

test('worker 의 fs.changed 를 받으면 펼친 폴더를 다시 읽는다', async () => {
  const calls: Calls = []
  const v = await open(calls)
  await v.expand({ label: '파일 트리' }, ROOT_KEY)
  const before = calls.filter((c) => c.name === 'fs.list').length
  await v.post('fs.changed', { rootId: 'ws:w1', dirs: [WS] })
  assert.equal(calls.filter((c) => c.name === 'fs.list').length, before + 1)
})
