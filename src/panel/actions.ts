// 패널 동작: worker 요청을 보내고 atom 을 갱신한다. 렌더 중에는 부르지 않는다(이벤트 핸들러·setup 에서만).
import { plugin, read, set, settings, update } from 'orca'
import '../protocol'
import {
  collapsedGroups,
  dirs,
  draft,
  expanded,
  groupKey,
  message,
  mode,
  nodeKey,
  parseNodeKey,
  preview,
  query,
  roots,
  rootsError,
  search,
  searchScope,
  selection,
  showIgnored,
  type DirState,
  type Mode,
  type Selection
} from './state'

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

export function parentOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i > 0 ? path.slice(0, i) : path.slice(0, i + 1) || path
}

export function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

const isUnder = (path: string, dir: string) => path === dir || path.startsWith(dir + '/') || path.startsWith(dir + '\\')

function notify(tone: 'success' | 'danger' | 'neutral', text: string): void {
  set(message, { tone, text })
}

// ---------------------------------------------------------------- 루트

export async function loadRoots(): Promise<void> {
  try {
    const answer = await plugin.request('roots.list')
    set(roots, answer.roots)
    set(rootsError, null)
  } catch (error) {
    set(rootsError, errorText(error))
  }
}

export async function addRoot(path: string): Promise<void> {
  try {
    const answer = await plugin.request('roots.add', { path })
    set(roots, answer.roots)
    set(mode, { kind: 'idle' })
    const added = answer.roots.find((r) => r.id === answer.added)
    if (added) {
      update(collapsedGroups, (g) => g.filter((x) => x !== added.group))
      await toggle(nodeKey(added.id, added.path), true)
      set(selection, { rootId: added.id, path: added.path, dir: true, isRoot: true })
    }
    notify('success', `경로를 추가했습니다: ${added?.path ?? path}`)
  } catch (error) {
    notify('danger', errorText(error))
  }
}

export async function removeRoot(rootId: string): Promise<void> {
  try {
    const answer = await plugin.request('roots.remove', { id: rootId })
    set(roots, answer.roots)
    update(expanded, (keys) => keys.filter((k) => parseNodeKey(k)?.rootId !== rootId))
    set(selection, null)
    set(preview, { status: 'none' })
    notify('neutral', '목록에서 경로를 뺐습니다. 파일은 그대로입니다.')
  } catch (error) {
    notify('danger', errorText(error))
  }
}

// ---------------------------------------------------------------- 폴더 목록

export async function loadDir(rootId: string, path: string): Promise<void> {
  const key = nodeKey(rootId, path)
  const put = (state: DirState) => update(dirs, (d) => ({ ...d, [key]: state }))
  const previous = read(dirs)[key]
  // 이미 보이는 목록은 새로 읽는 동안 유지해 깜박임을 막는다.
  if (!previous || previous.status !== 'ready') put({ status: 'loading' })
  try {
    const answer = await plugin.request('fs.list', { rootId, path })
    put({ status: 'ready', entries: answer.entries, truncated: answer.truncated })
  } catch (error) {
    put({ status: 'error', message: errorText(error) })
  }
}

/** 저장된 펼침 상태를 다시 읽는다(패널을 연 직후, 설정 변경 후). */
export async function reloadExpanded(): Promise<void> {
  const known = new Set((read(roots) ?? []).filter((r) => !r.disabled).map((r) => r.id))
  const keys = read(expanded).filter((k) => known.has(parseNodeKey(k)?.rootId ?? ''))
  set(dirs, Object.fromEntries(Object.entries(read(dirs)).filter(([k]) => keys.includes(k))))
  await Promise.all(keys.map((k) => parseNodeKey(k)).map((n) => (n ? loadDir(n.rootId, n.path) : undefined)))
}

export async function refreshAll(): Promise<void> {
  await loadRoots()
  await reloadExpanded()
  const s = read(search)
  if (s.status === 'ready' || s.status === 'error') await runSearch(s.query)
}

/** worker 가 알린 폴더들을 다시 읽는다. 펼치지 않은 폴더는 캐시만 버린다. */
export async function invalidate(paths: string[]): Promise<void> {
  const open = new Set(read(expanded))
  const reload: { rootId: string; path: string }[] = []
  const drop: string[] = []
  for (const key of Object.keys(read(dirs))) {
    const node = parseNodeKey(key)
    if (!node || !paths.includes(node.path)) continue
    if (open.has(key)) reload.push(node)
    else drop.push(key)
  }
  if (drop.length) update(dirs, (d) => Object.fromEntries(Object.entries(d).filter(([k]) => !drop.includes(k))))
  await Promise.all(reload.map((n) => loadDir(n.rootId, n.path)))
  const s = read(search)
  if (s.status === 'ready') await runSearch(s.query)
}

// ---------------------------------------------------------------- 트리 상호작용

export async function toggle(key: string, open: boolean): Promise<void> {
  if (key.startsWith('\u0001')) {
    const group = key.slice(1)
    update(collapsedGroups, (g) => (open ? g.filter((x) => x !== group) : [...new Set([...g, group])]))
    return
  }
  const node = parseNodeKey(key)
  if (!node) return
  update(expanded, (keys) => (open ? [...new Set([...keys, key])] : keys.filter((k) => k !== key)))
  if (open && read(dirs)[key]?.status !== 'ready') await loadDir(node.rootId, node.path)
}

/** 키로 선택 정보를 찾는다: 루트인지, 로드된 목록에서 폴더인지. */
export function selectionOf(key: string): Selection | null {
  const node = parseNodeKey(key)
  if (!node) return null
  const root = (read(roots) ?? []).find((r) => r.id === node.rootId && r.path === node.path)
  if (root) return { ...node, dir: true, isRoot: true }
  const parent = read(dirs)[nodeKey(node.rootId, parentOf(node.path))]
  const entry = parent?.status === 'ready' ? parent.entries.find((e) => e.path === node.path) : undefined
  return entry ? { ...node, dir: entry.dir, isRoot: false } : null
}

export async function select(next: Selection | null): Promise<void> {
  set(selection, next)
  set(mode, { kind: 'idle' })
  if (next && !next.dir) await loadPreview(next.rootId, next.path)
  else set(preview, { status: 'none' })
}

export async function selectKey(key: string): Promise<void> {
  if (key.startsWith('\u0001')) return
  const next = selectionOf(key)
  if (next) await select(next)
}

export async function activateKey(key: string): Promise<void> {
  if (key.startsWith('\u0001')) {
    const group = key.slice(1)
    await toggle(groupKey(group), read(collapsedGroups).includes(group))
    return
  }
  const sel = selectionOf(key)
  if (!sel) return
  if (sel.dir) await toggle(key, !read(expanded).includes(key))
  else await openFile(sel)
}

let previewSeq = 0
export async function loadPreview(rootId: string, path: string): Promise<void> {
  const seq = ++previewSeq
  set(preview, { status: 'loading', path })
  try {
    const answer = await plugin.request('fs.preview', { rootId, path })
    if (seq === previewSeq) set(preview, { status: 'ready', preview: answer })
  } catch (error) {
    if (seq === previewSeq) set(preview, { status: 'error', path, message: errorText(error) })
  }
}

export async function openFile(sel: Selection): Promise<void> {
  try {
    await plugin.request('fs.open', { rootId: sel.rootId, path: sel.path })
  } catch (error) {
    notify('danger', errorText(error))
  }
}

// ---------------------------------------------------------------- 검색

let searchSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined

export async function runSearch(text: string): Promise<void> {
  const q = text.trim()
  const seq = ++searchSeq
  if (!q) {
    set(search, { status: 'idle' })
    return
  }
  set(search, { status: 'loading', query: q })
  const scope = read(searchScope)
  try {
    const answer = await plugin.request(
      'fs.search',
      scope === 'all' ? { query: q } : { query: q, rootId: scope },
      { timeoutMs: 60000 }
    )
    if (seq === searchSeq) set(search, { status: 'ready', query: q, hits: answer.hits, truncated: answer.truncated })
  } catch (error) {
    if (seq === searchSeq) set(search, { status: 'error', query: q, message: errorText(error) })
  }
}

/** 입력 중에는 잠깐 기다렸다가 검색한다(2자 이상). Enter 는 바로 검색. */
export function typeQuery(text: string): void {
  set(query, text)
  if (searchTimer) clearTimeout(searchTimer)
  if (text.trim().length === 0) {
    searchSeq++
    set(search, { status: 'idle' })
    return
  }
  if (text.trim().length < 2) return
  searchTimer = setTimeout(() => void runSearch(text), 250)
}

export async function submitQuery(text: string): Promise<void> {
  if (searchTimer) clearTimeout(searchTimer)
  set(query, text)
  await runSearch(text)
}

export async function clearQuery(): Promise<void> {
  if (searchTimer) clearTimeout(searchTimer)
  searchSeq++
  set(query, '')
  set(search, { status: 'idle' })
}

export async function setScope(scope: string): Promise<void> {
  set(searchScope, scope)
  const q = read(query)
  if (q.trim()) await runSearch(q)
}

// ---------------------------------------------------------------- 파일 조작

/** 새 항목을 만들 폴더: 폴더를 골랐으면 그 폴더, 파일이면 부모. */
export function targetDir(sel: Selection): string {
  return sel.dir ? sel.path : parentOf(sel.path)
}

export async function createEntry(name: string, kind: 'file' | 'dir'): Promise<void> {
  const sel = read(selection)
  if (!sel) return notify('neutral', '먼저 폴더나 파일을 선택하세요.')
  const dir = targetDir(sel)
  try {
    const answer = await plugin.request('fs.create', { rootId: sel.rootId, dir, name, kind })
    set(mode, { kind: 'idle' })
    await toggle(nodeKey(sel.rootId, dir), true)
    await loadDir(sel.rootId, dir)
    await select({ rootId: sel.rootId, path: answer.path, dir: kind === 'dir', isRoot: false })
    notify('success', `${kind === 'dir' ? '폴더를' : '파일을'} 만들었습니다: ${baseName(answer.path)}`)
  } catch (error) {
    notify('danger', errorText(error))
  }
}

export async function renameSelected(newName: string): Promise<void> {
  const sel = read(selection)
  if (!sel || sel.isRoot) return
  try {
    const answer = await plugin.request('fs.rename', { rootId: sel.rootId, path: sel.path, newName })
    // 펼쳐 둔 하위 폴더 키를 새 경로로 옮긴다.
    update(expanded, (keys) =>
      keys.map((k) => {
        const n = parseNodeKey(k)
        return n && n.rootId === sel.rootId && isUnder(n.path, sel.path)
          ? nodeKey(n.rootId, answer.path + n.path.slice(sel.path.length))
          : k
      })
    )
    set(mode, { kind: 'idle' })
    await loadDir(sel.rootId, parentOf(sel.path))
    await select({ ...sel, path: answer.path })
    notify('success', `이름을 바꿨습니다: ${baseName(answer.path)}`)
  } catch (error) {
    notify('danger', errorText(error))
  }
}

export async function deleteSelected(): Promise<void> {
  const sel = read(selection)
  if (!sel || sel.isRoot) return
  try {
    await plugin.request('fs.delete', { rootId: sel.rootId, path: sel.path })
    update(expanded, (keys) => keys.filter((k) => {
      const n = parseNodeKey(k)
      return !(n && n.rootId === sel.rootId && isUnder(n.path, sel.path))
    }))
    set(mode, { kind: 'idle' })
    set(selection, null)
    set(preview, { status: 'none' })
    await loadDir(sel.rootId, parentOf(sel.path))
    notify('success', `휴지통으로 옮겼습니다: ${baseName(sel.path)}`)
  } catch (error) {
    notify('danger', errorText(error))
  }
}

export async function setShowIgnored(value: boolean): Promise<void> {
  set(showIgnored, value)
  try {
    await settings.set('showIgnored', value) // onDidChange 가 목록을 다시 읽는다
  } catch (error) {
    notify('danger', errorText(error))
  }
}

// ---------------------------------------------------------------- 모드 전환

export function startMode(next: Mode): void {
  const sel = read(selection)
  set(draft, next.kind === 'rename' && sel ? baseName(sel.path) : '')
  set(mode, next)
}

export function cancelMode(): void {
  set(mode, { kind: 'idle' })
  set(draft, '')
}

/** 검색 결과 항목을 트리에서 보이도록 조상 폴더를 차례로 펼치고 검색을 닫는다. */
export async function reveal(sel: Selection): Promise<void> {
  const root = (read(roots) ?? []).find((r) => r.id === sel.rootId)
  if (!root) return
  update(collapsedGroups, (g) => g.filter((x) => x !== root.group))
  const chain: string[] = []
  for (let p = parentOf(sel.path); isUnder(p, root.path); p = parentOf(p)) {
    chain.unshift(p)
    if (p === root.path || parentOf(p) === p) break
  }
  for (const dir of chain) await toggle(nodeKey(root.id, dir), true)
  await clearQuery()
  set(selection, sel)
}
