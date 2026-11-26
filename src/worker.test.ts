// worker 핸들러를 mock host 위에서 실제 임시 디렉터리로 돌린다.
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, beforeEach, mockHost, mountWorker, test, type TestWorker } from 'orca/testing'
import * as main from './worker'

let base = ''
let wsPath = ''
let extra = ''
let worker: TestWorker | undefined

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'wsx-worker-')))
  wsPath = join(base, 'repo')
  extra = join(base, 'extra')
  await mkdir(join(wsPath, 'src'), { recursive: true })
  await mkdir(extra)
  await writeFile(join(wsPath, 'src/index.ts'), 'console.log(1)\n')
  await writeFile(join(extra, 'notes.md'), '# notes\n')
})

afterEach(async () => {
  await worker?.deactivate()
  worker = undefined
  await rm(base, { recursive: true, force: true })
})

async function mountWith(storage: Record<string, string[]> = {}) {
  const host = mockHost({
    storage,
    results: {
      'workspace.list': {
        workspaces: [
          { id: 'w1', kind: 'worktree', name: 'main', project: 'repo', projectId: 'p1', path: wsPath, branch: 'refs/heads/main', hostId: 'local' },
          { id: 'w2', kind: 'worktree', name: 'remote', project: 'srv', projectId: 'p2', path: '/srv/x', branch: null, hostId: 'ssh:box' }
        ],
        truncated: false
      },
      'project.list': {
        projects: [{ id: 'p1', name: 'Repo', kind: 'git', hostId: 'local', path: wsPath }],
        truncated: false
      },
      'editor.open': { opened: true }
    }
  })
  worker = await mountWorker(main, { host })
  return worker
}

test('roots.list: 프로젝트 이름으로 묶고 원격은 비활성', async () => {
  const w = await mountWith({ 'roots.custom': [extra] })
  const { roots } = await w.request('roots.list')
  assert.deepEqual(
    roots.map((r) => [r.id, r.group, r.branch ?? null, r.disabled ?? false]),
    [
      ['ws:w1', 'Repo', 'main', false],
      ['ws:w2', 'srv', null, true],
      [`p:${extra}`, '내 경로', null, false]
    ]
  )
  assert.deepEqual(w.refusals, [])
})

test('fs.list / fs.preview / fs.open', async () => {
  const w = await mountWith()
  const list = await w.request('fs.list', { rootId: 'ws:w1', path: wsPath })
  assert.deepEqual(list.entries.map((e) => e.name), ['src'])

  const preview = await w.request('fs.preview', { rootId: 'ws:w1', path: join(wsPath, 'src/index.ts') })
  assert.equal(preview.text, 'console.log(1)\n')

  await w.request('fs.open', { rootId: 'ws:w1', path: join(wsPath, 'src/index.ts') })
  assert.deepEqual(w.host.callsOf('editor.open'), [
    { workspaceId: 'w1', path: 'src/index.ts' }
  ])
  assert.deepEqual(w.refusals, [])
})

test('원격 루트와 루트 밖 경로는 거부', async () => {
  const w = await mountWith()
  await assert.rejects(w.request('fs.list', { rootId: 'ws:w2', path: '/srv/x' }))
  await assert.rejects(w.request('fs.list', { rootId: 'ws:w1', path: base }))
})

test('roots.add / roots.remove 는 storage 에 경로를 남긴다', async () => {
  const w = await mountWith()
  const added = await w.request('roots.add', { path: extra })
  assert.equal(added.added, `p:${extra}`)
  assert.deepEqual(w.host.data().storage['roots.custom'], [extra])
  await assert.rejects(w.request('roots.add', { path: join(extra, 'notes.md') }))
  await assert.rejects(w.request('roots.add', { path: 'relative' }))

  // 사용자 경로의 파일은 담고 있는 워크스페이스가 없으면 탭으로 열 수 없다.
  await assert.rejects(w.request('fs.open', { rootId: `p:${extra}`, path: join(extra, 'notes.md') }))

  const removed = await w.request('roots.remove', { id: `p:${extra}` })
  assert.ok(!removed.roots.some((r) => r.kind === 'custom'))
  assert.deepEqual(w.host.data().storage['roots.custom'], [])
})

test('사용자 경로가 워크스페이스 안이면 그 워크스페이스로 연다', async () => {
  const w = await mountWith({ 'roots.custom': [join(wsPath, 'src')] })
  await w.request('fs.open', { rootId: `p:${join(wsPath, 'src')}`, path: join(wsPath, 'src/index.ts') })
  assert.equal(w.host.callsOf('editor.open').length, 1)
})

test('fs.create / fs.rename / fs.delete 는 fs.changed 를 알린다', async () => {
  const w = await mountWith()
  const created = await w.request('fs.create', { rootId: 'ws:w1', dir: join(wsPath, 'src'), name: 'a.ts', kind: 'file' })
  assert.equal(created.path, join(wsPath, 'src/a.ts'))
  const renamed = await w.request('fs.rename', { rootId: 'ws:w1', path: created.path, newName: 'b.ts' })
  assert.equal(renamed.path, join(wsPath, 'src/b.ts'))
  await assert.rejects(w.request('fs.rename', { rootId: 'ws:w1', path: wsPath, newName: 'x' }))
  await assert.rejects(w.request('fs.delete', { rootId: 'ws:w1', path: wsPath }))
  assert.deepEqual(
    w.posts.map((p) => p.event),
    ['fs.changed', 'fs.changed']
  )
  assert.deepEqual(w.posts[0]?.payload, { rootId: 'ws:w1', dirs: [join(wsPath, 'src')] })
})

test('fs.search: 여러 루트에서 이름으로 찾는다', async () => {
  const w = await mountWith({ 'roots.custom': [extra] })
  const { hits } = await w.request('fs.search', { query: 'not' })
  assert.deepEqual(hits.map((h) => [h.rootId, h.rel]), [[`p:${extra}`, 'notes.md']])
  const scoped = await w.request('fs.search', { query: 'index', rootId: 'ws:w1' })
  assert.deepEqual(scoped.hits.map((h) => h.rel), ['src/index.ts'])
})
