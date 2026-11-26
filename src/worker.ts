// Workspace Explorer worker: 패널의 요청을 받아 로컬 파일시스템을 읽고 쓰고, 파일을 Orca 탭으로 연다.
// 저장 시 재시작되므로 오래 남겨야 할 상태(사용자 경로)는 orca.storage 에 둔다.
import { realpath, stat } from 'node:fs/promises'
import { dirname, join, posix, relative, sep } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import './protocol'
import type { ExplorerHit, ExplorerRoot } from './types'
import { listDir } from './fs/list'
import { createEntry, renameEntry, trashEntry } from './fs/ops'
import { runOrcaCli } from './fs/orcaCli'
import { ExplorerError, expandPath, isInside, resolveChild, resolveExisting } from './fs/paths'
import {
  buildRoots,
  containingWorkspace,
  CUSTOM_ROOTS_KEY,
  LOCATION_PREFIX,
  locationRoot,
  projectDirFor
} from './fs/roots'
import { listAll, matchEntries } from './fs/search'

const MAX_HITS = 200
const ROOTS_TTL_MS = 5000

type Settings = { showIgnored: boolean; maxEntriesPerDir: number }

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function real(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  let cache: { at: number; roots: ExplorerRoot[] } | null = null

  async function customPaths(): Promise<string[]> {
    const value = await orca.storage.get(CUSTOM_ROOTS_KEY)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  }

  async function loadRoots(force = false): Promise<ExplorerRoot[]> {
    if (!force && cache && Date.now() - cache.at < ROOTS_TTL_MS) return cache.roots
    const [{ workspaces }, projects, custom] = await Promise.all([
      orca.host.call('workspace.list', {}),
      orca.host.call('project.list', {}).then((r) => r.projects).catch(() => []),
      customPaths()
    ])
    cache = { at: Date.now(), roots: buildRoots(workspaces, projects, custom) }
    return cache.roots
  }

  async function root(rootId: string): Promise<ExplorerRoot> {
    // Finder 식 "위치": 어떤 폴더든 임시 루트가 된다.
    if (rootId.startsWith(LOCATION_PREFIX)) {
      const path = rootId.slice(LOCATION_PREFIX.length)
      if (!(await isDirectory(path))) throw new ExplorerError('invalid_params', `폴더가 아니거나 없습니다: ${path}`)
      return locationRoot(path)
    }
    let found = (await loadRoots()).find((r) => r.id === rootId)
    if (!found) found = (await loadRoots(true)).find((r) => r.id === rootId)
    if (!found) throw new ExplorerError('invalid_params', '루트를 찾을 수 없습니다. 새로고침하세요.')
    if (found.disabled) throw new ExplorerError('not_permitted', found.reason ?? '사용할 수 없는 루트입니다.')
    return found
  }

  async function settings(): Promise<Settings> {
    const all = await orca.settings.get()
    return {
      showIgnored: all.showIgnored === true,
      maxEntriesPerDir: typeof all.maxEntriesPerDir === 'number' ? all.maxEntriesPerDir : 500
    }
  }

  function changed(rootId: string, ...dirs: string[]): void {
    orca.panels.post('fs.changed', { rootId, dirs })
  }

  /** 루트 자체는 이름 변경·삭제하지 않는다. */
  function notRoot(r: ExplorerRoot, path: string): void {
    if (path === r.path || path + sep === r.path) {
      throw new ExplorerError('not_permitted', '루트 폴더 자체는 바꿀 수 없습니다.')
    }
  }

  /** `dir` 을 Orca 폴더 프로젝트로 등록하고 그 워크스페이스를 돌려준다. */
  async function registerFolder(dir: string): Promise<ExplorerRoot> {
    const cli = await runOrcaCli(['repo', 'add', '--path', dir, '--kind', 'folder'])
    const want = await real(dir)
    // 등록이 목록에 반영되기까지 잠깐 걸릴 수 있어 몇 번 다시 읽는다.
    for (let attempt = 0; attempt < 6; attempt++) {
      for (const r of await loadRoots(true)) {
        if (r.kind === 'workspace' && !r.disabled && (r.path === dir || (await real(r.path)) === want)) return r
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    orca.log(`repo add failed for ${dir}: ${cli.output.slice(0, 500)}`)
    throw new ExplorerError('action_failed', `폴더를 Orca 프로젝트로 등록하지 못했습니다: ${dir}`)
  }

  orca.panels.handle('roots.list', async () => ({ roots: await loadRoots(true) }))

  orca.panels.handle('roots.add', async ({ path }) => {
    const abs = expandPath(path)
    if (!(await isDirectory(abs))) throw new ExplorerError('invalid_params', `폴더가 아니거나 없습니다: ${abs}`)
    const current = await customPaths()
    if (!current.includes(abs)) await orca.storage.set(CUSTOM_ROOTS_KEY, [...current, abs])
    return { roots: await loadRoots(true), added: `p:${abs}` }
  })

  orca.panels.handle('roots.remove', async ({ id }) => {
    if (!id.startsWith('p:')) throw new ExplorerError('not_permitted', '워크스페이스는 여기서 제거할 수 없습니다.')
    const path = id.slice(2)
    await orca.storage.set(CUSTOM_ROOTS_KEY, (await customPaths()).filter((p) => p !== path))
    return { roots: await loadRoots(true) }
  })

  /** 위치 입력창의 경로(~ 허용)를 실제 폴더 경로로 바꾼다. */
  orca.panels.handle('fs.resolveDir', async ({ path }) => {
    const abs = expandPath(path)
    if (!(await isDirectory(abs))) throw new ExplorerError('invalid_params', `폴더가 아니거나 없습니다: ${abs}`)
    return { path: abs }
  })

  orca.panels.handle('fs.list', async ({ rootId, path }) => {
    const r = await root(rootId)
    const dir = await resolveExisting(r.path, path)
    const s = await settings()
    return listDir(dir, { showIgnored: s.showIgnored, limit: s.maxEntriesPerDir })
  })

  orca.panels.handle('fs.search', async ({ query, rootId }, { signal }) => {
    if (query.trim().length === 0) return { hits: [], truncated: false }
    const s = await settings()
    const roots = rootId ? [await root(rootId)] : (await loadRoots()).filter((r) => !r.disabled)
    const hits: ExplorerHit[] = []
    let truncated = false
    for (const r of roots) {
      if (signal.aborted) break
      const all = await listAll(r.path, { showIgnored: s.showIgnored, signal })
      if (!all) continue
      for (const m of matchEntries(all, query)) {
        if (hits.length >= MAX_HITS) {
          truncated = true
          break
        }
        hits.push({ rootId: r.id, path: join(r.path, ...m.rel.split(posix.sep)), rel: m.rel, dir: m.dir })
      }
      if (truncated) break
    }
    return { hits, truncated }
  })

  orca.panels.handle('fs.open', async ({ rootId, path }) => {
    const r = await root(rootId)
    const file = await resolveExisting(r.path, path)
    if (await isDirectory(file)) throw new ExplorerError('invalid_params', '폴더는 탭으로 열 수 없습니다.')

    let ws = r.kind === 'workspace' ? r : containingWorkspace(await loadRoots(), file)
    let registered: string | undefined
    if (!ws) {
      registered = projectDirFor(r.path, file)
      ws = await registerFolder(registered)
    }
    if (!ws.workspaceId) throw new ExplorerError('action_failed', '워크스페이스를 찾지 못했습니다.')

    // Orca 의 탭은 워크스페이스마다 따로 있다: 다른 워크스페이스면 먼저 그쪽으로 화면을 옮긴다.
    const context = await orca.host.call('workspace.readContext', {}).catch(() => null)
    if (context?.workspaceId !== ws.workspaceId) {
      await orca.host.call('workspace.open', { workspaceId: ws.workspaceId })
    }
    // editor.open 은 워크스페이스 기준 상대경로(posix 구분자)를 받는다.
    const inside = isInside(ws.path, file)
    const rel = relative(inside ? ws.path : await real(ws.path), inside ? file : await real(file))
      .split(sep)
      .join(posix.sep)
    await orca.host.call('editor.open', { workspaceId: ws.workspaceId, path: rel })
    return { opened: true, ...(registered ? { registered } : {}) }
  })

  orca.panels.handle('fs.create', async ({ rootId, dir, name, kind }) => {
    const r = await root(rootId)
    const target = await resolveChild(r.path, dir, name)
    await createEntry(target, kind)
    changed(r.id, dirname(target))
    return { path: target }
  })

  orca.panels.handle('fs.rename', async ({ rootId, path, newName }) => {
    const r = await root(rootId)
    const current = await resolveExisting(r.path, path)
    notRoot(r, current)
    const next = await renameEntry(current, newName)
    changed(r.id, dirname(current))
    return { path: next }
  })

  orca.panels.handle('fs.delete', async ({ rootId, path }) => {
    const r = await root(rootId)
    const target = await resolveExisting(r.path, path)
    notRoot(r, target)
    const trashedTo = await trashEntry(target)
    changed(r.id, dirname(target))
    return { trashedTo }
  })
}
