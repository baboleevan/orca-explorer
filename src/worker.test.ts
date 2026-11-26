// worker 핸들러를 mock host 위에서 실제 임시 디렉터리로 돌린다.
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, beforeEach, mockHost, mountWorker, test, type TestWorker } from 'orca/testing'
import * as main from './worker'

let base = ''
let wsPath = ''
let extra = ''
let worker: TestWorker | undefined

const ws = (id: string, path: string, more: object = {}) => ({
  id, kind: 'worktree', name: id, project: 'repo', projectId: 'p1', path, branch: 'refs/heads/main', hostId: 'local', ...more
})

beforeEach(async () => {
  // 실제 orca CLI 가 불리면 사용자의 Orca 에 프로젝트가 생긴다: 기본은 늘 실패하는 가짜로.
  process.env.ORCA_CLI = '/usr/bin/false'
  base = await realpath(await mkdtemp(join(tmpdir(), 'wsx-worker-')))
  wsPath = join(base, 'repo')
  extra = join(base, 'extra')
  await mkdir(join(wsPath, 'src'), { recursive: true })
  await mkdir(join(extra, 'sub'), { recursive: true })
  await writeFile(join(wsPath, 'src/index.ts'), 'console.log(1)\n')
  await writeFile(join(extra, 'notes.md'), '# notes\n')
  await writeFile(join(extra, 'sub/deep.md'), '')
})

afterEach(async () => {
  await worker?.deactivate()
  worker = undefined
  delete process.env.ORCA_CLI
  await rm(base, { recursive: true, force: true })
})

async function mountWith(storage: Record<string, string[]> = {}, current = 'w1') {
  const host = mockHost({
    storage,
    results: {
      'workspace.list': {
        workspaces: [
          ws('w1', wsPath),
          ws('w2', '/srv/x', { name: 'remote', project: 'srv', projectId: 'p2', branch: null, hostId: 'ssh:box' }),
          ws('w3', '/hidden', { kind: 'folder', projectId: 'p3', branch: null })
        ],
        truncated: false
      },
      'project.list': {
        projects: [
          { id: 'p1', name: 'Repo', kind: 'git', hostId: 'local', path: wsPath },
          { id: 'p3', name: 'Hidden', kind: 'folder', hostId: 'local', path: '/hidden', hidden: true }
        ],
        truncated: false
      },
      'workspace.readContext': { workspaceId: current, branch: 'main', displayName: current, terminals: [] },
      'workspace.open': { opened: true },
      'editor.open': { opened: true }
    }
  })
  worker = await mountWorker(main, { host })
  return worker
}

test('roots.list: 프로젝트 이름으로 묶고, 원격은 비활성, 숨긴 프로젝트는 뺀다', async () => {
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

test('fs.open: 현재 워크스페이스 파일은 화면 전환 없이 상대경로로 연다', async () => {
  const w = await mountWith()
  const list = await w.request('fs.list', { rootId: 'ws:w1', path: wsPath })
  assert.deepEqual(list.entries.map((e) => e.name), ['src'])
  await w.request('fs.open', { rootId: 'ws:w1', path: join(wsPath, 'src/index.ts') })
  assert.deepEqual(w.host.callsOf('editor.open'), [{ workspaceId: 'w1', path: 'src/index.ts' }])
  assert.equal(w.host.callsOf('workspace.open').length, 0)
  await assert.rejects(w.request('fs.open', { rootId: 'ws:w1', path: join(wsPath, 'src') }))
  assert.deepEqual(w.refusals, [])
})

test('fs.open: 다른 워크스페이스 파일이면 그 워크스페이스로 전환한 뒤 연다', async () => {
  const w = await mountWith({}, 'other')
  await w.request('fs.open', { rootId: 'ws:w1', path: join(wsPath, 'src/index.ts') })
  assert.deepEqual(w.host.callsOf('workspace.open'), [{ workspaceId: 'w1' }])
  assert.equal(w.host.callsOf('editor.open').length, 1)
})

test('fs.open: 사용자 경로가 워크스페이스 안이면 등록 없이 그 워크스페이스로 연다', async () => {
  const w = await mountWith({ 'roots.custom': [join(wsPath, 'src')] })
  const answer = await w.request('fs.open', { rootId: `p:${join(wsPath, 'src')}`, path: join(wsPath, 'src/index.ts') })
  assert.equal(answer.registered, undefined)
  assert.deepEqual(w.host.callsOf('editor.open'), [{ workspaceId: 'w1', path: 'src/index.ts' }])
})

test('fs.open: 워크스페이스 밖 위치면 폴더 프로젝트로 등록한 뒤 연다', async () => {
  // 가짜 orca CLI: 받은 인자를 기록하고 성공을 답한다.
  const log = join(base, 'cli.log')
  const cli = join(base, 'fake-orca')
  await writeFile(cli, `#!/bin/sh\necho "$@" >> "${log}"\necho '{"ok":true}'\n`)
  await chmod(cli, 0o755)
  process.env.ORCA_CLI = cli

  const w = await mountWith()
  await w.request('roots.list') // 등록 전 목록을 캐시
  w.host.respond('workspace.list', {
    workspaces: [ws('w1', wsPath), ws('f1', extra, { kind: 'folder', name: 'extra', projectId: 'p9', branch: null })],
    truncated: false
  })
  const answer = await w.request('fs.open', { rootId: `loc:${extra}`, path: join(extra, 'sub/deep.md') })
  assert.equal(answer.registered, extra)
  assert.ok((await readFile(log, 'utf8')).includes(`repo add --path ${extra} --kind folder --json`))
  assert.deepEqual(w.host.callsOf('workspace.open'), [{ workspaceId: 'f1' }])
  assert.deepEqual(w.host.callsOf('editor.open'), [{ workspaceId: 'f1', path: 'sub/deep.md' }])

  // 등록에 실패하면 오류를 돌려준다(가짜 CLI 가 실패하고 목록에도 없을 때).
  process.env.ORCA_CLI = '/usr/bin/false'
  await assert.rejects(w.request('fs.open', { rootId: `loc:${wsPath}/..`, path: join(base, 'cli.log') }))

  // 이미 등록된 폴더 안이면 다시 등록하지 않는다.
  process.env.ORCA_CLI = cli
  await w.request('fs.open', { rootId: `loc:${join(extra, 'sub')}`, path: join(extra, 'sub/deep.md') })
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1)
})

test('위치(loc:) 루트: 어떤 폴더든 목록·조작이 되고, 없는 폴더·루트 밖은 거부', async () => {
  const w = await mountWith()
  assert.deepEqual(await w.request('fs.resolveDir', { path: extra }), { path: extra })
  await assert.rejects(w.request('fs.resolveDir', { path: join(extra, 'notes.md') }))
  const list = await w.request('fs.list', { rootId: `loc:${extra}`, path: extra })
  assert.deepEqual(list.entries.map((e) => e.name), ['sub', 'notes.md'])
  const created = await w.request('fs.create', { rootId: `loc:${extra}`, dir: extra, name: 'new.txt', kind: 'file' })
  assert.equal(created.path, join(extra, 'new.txt'))
  await assert.rejects(w.request('fs.list', { rootId: `loc:${join(base, 'missing')}`, path: join(base, 'missing') }))
  await assert.rejects(w.request('fs.list', { rootId: `loc:${extra}`, path: wsPath }))
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
  const removed = await w.request('roots.remove', { id: `p:${extra}` })
  assert.ok(!removed.roots.some((r) => r.kind === 'custom'))
  assert.deepEqual(w.host.data().storage['roots.custom'], [])
})

test('fs.create / fs.rename / fs.delete 는 fs.changed 를 알린다', async () => {
  const w = await mountWith()
  const created = await w.request('fs.create', { rootId: 'ws:w1', dir: join(wsPath, 'src'), name: 'a.ts', kind: 'file' })
  assert.equal(created.path, join(wsPath, 'src/a.ts'))
  const renamed = await w.request('fs.rename', { rootId: 'ws:w1', path: created.path, newName: 'b.ts' })
  assert.equal(renamed.path, join(wsPath, 'src/b.ts'))
  await assert.rejects(w.request('fs.rename', { rootId: 'ws:w1', path: wsPath, newName: 'x' }))
  await assert.rejects(w.request('fs.delete', { rootId: 'ws:w1', path: wsPath }))
  assert.deepEqual(w.posts.map((p) => p.event), ['fs.changed', 'fs.changed'])
  assert.deepEqual(w.posts[0]?.payload, { rootId: 'ws:w1', dirs: [join(wsPath, 'src')] })
})

test('fs.search: 여러 루트와 위치에서 이름으로 찾는다', async () => {
  const w = await mountWith({ 'roots.custom': [extra] })
  const { hits } = await w.request('fs.search', { query: 'not' })
  assert.deepEqual(hits.map((h) => [h.rootId, h.rel]), [[`p:${extra}`, 'notes.md']])
  const scoped = await w.request('fs.search', { query: 'deep', rootId: `loc:${extra}` })
  assert.deepEqual(scoped.hits.map((h) => h.rel), ['sub/deep.md'])
})
