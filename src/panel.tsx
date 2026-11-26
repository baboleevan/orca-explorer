// Workspace Explorer 패널. 빌드 없이 Orca 가 TSX 를 변환한다. 상태는 src/panel/state.ts 의 atom 에 있다.
import {
  Box,
  Button,
  Callout,
  Card,
  CodeView,
  EmptyState,
  IconButton,
  Input,
  List,
  ListItem,
  on,
  plugin,
  read,
  Row,
  Select,
  set,
  settings,
  Skeleton,
  Spinner,
  Stack,
  Switch,
  Text,
  Toolbar,
  Tree,
  type PanelContext
} from 'orca'
import './protocol'
import {
  activateKey,
  addRoot,
  baseName,
  cancelMode,
  clearQuery,
  createEntry,
  deleteSelected,
  invalidate,
  loadPreview,
  loadRoots,
  openFile,
  parentOf,
  refreshAll,
  reloadExpanded,
  removeRoot,
  renameSelected,
  reveal,
  select,
  selectKey,
  setScope,
  setShowIgnored,
  startMode,
  submitQuery,
  toggle,
  typeQuery
} from './panel/actions'
import {
  collapsedGroups,
  currentWorkspaceId,
  dirs,
  draft,
  expanded,
  message,
  mode,
  nodeKey,
  preview,
  query,
  roots,
  rootsError,
  search,
  searchScope,
  selection,
  showIgnored
} from './panel/state'
import { buildTree, expandedKeys } from './panel/tree'

export function setup(ctx: PanelContext): void {
  void settings.get('showIgnored').then((v) => set(showIgnored, v === true))
  void loadRoots().then(reloadExpanded)
  ctx.subscriptions.push(
    plugin.on('fs.changed', ({ dirs: changed }) => void invalidate(changed)),
    on('workspace.created', () => void loadRoots()),
    on('workspace.removed', () => void loadRoots()),
    on('workspace.changed', ({ context }) => set(currentWorkspaceId, context?.workspaceId ?? null)),
    settings.onDidChange(({ key }) => {
      if (key === 'showIgnored') void settings.get('showIgnored').then((v) => set(showIgnored, v === true))
      if (key === 'showIgnored' || key === 'maxEntriesPerDir') void reloadExpanded()
      if (key === 'previewMaxKB') {
        const sel = read(selection)
        if (sel && !sel.dir) void loadPreview(sel.rootId, sel.path)
      }
    })
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Actions() {
  const sel = read(selection)
  const root = sel ? (read(roots) ?? []).find((r) => r.id === sel.rootId) : undefined
  const fileOps = sel !== null
  const itemOps = sel !== null && !sel.isRoot
  return (
    <Toolbar label="탐색기 도구" gap="xs">
      <IconButton icon="refresh" label="새로고침" tooltip="새로고침" variant="ghost" size="sm" onPress={refreshAll} />
      <IconButton icon="add" label="경로 추가" tooltip="폴더 경로 추가" variant="ghost" size="sm" onPress={() => startMode({ kind: 'addRoot' })} />
      <IconButton icon="file" label="새 파일" tooltip="새 파일" variant="ghost" size="sm" disabled={!fileOps} onPress={() => startMode({ kind: 'create', type: 'file' })} />
      <IconButton icon="folder" label="새 폴더" tooltip="새 폴더" variant="ghost" size="sm" disabled={!fileOps} onPress={() => startMode({ kind: 'create', type: 'dir' })} />
      <IconButton icon="edit" label="이름 변경" tooltip="이름 변경" variant="ghost" size="sm" disabled={!itemOps} onPress={() => startMode({ kind: 'rename' })} />
      <IconButton icon="delete" label="삭제" tooltip="휴지통으로 이동" variant="ghost" size="sm" tone={itemOps ? 'danger' : undefined} disabled={!itemOps} onPress={() => startMode({ kind: 'delete' })} />
      {sel?.isRoot && root?.kind === 'custom' ? (
        <IconButton icon="remove" label="경로 빼기" tooltip="목록에서 이 경로 빼기 (파일은 그대로)" variant="ghost" size="sm" onPress={() => removeRoot(root.id)} />
      ) : null}
    </Toolbar>
  )
}

function SearchBar() {
  const scopeOptions = [
    { value: 'all', label: '모든 루트' },
    ...(read(roots) ?? []).filter((r) => !r.disabled).map((r) => ({ value: r.id, label: `${r.group} / ${r.label}` }))
  ]
  const scope = read(searchScope)
  return (
    <Stack gap="xs">
      <Input
        label="파일 검색"
        labelHidden
        type="search"
        placeholder="파일 이름 검색 (경로는 / 포함)"
        value={read(query)}
        onChange={typeQuery}
        onSubmit={submitQuery}
      />
      {read(query) ? (
        <Row gap="xs" align="center">
          <Box grow>
            <Select
              label="검색 범위"
              labelHidden
              value={scopeOptions.some((o) => o.value === scope) ? scope : 'all'}
              options={scopeOptions}
              onChange={setScope}
            />
          </Box>
          <IconButton icon="close" label="검색 지우기" variant="ghost" size="sm" onPress={clearQuery} />
        </Row>
      ) : null}
    </Stack>
  )
}

function ModeForm() {
  const m = read(mode)
  const sel = read(selection)
  const value = read(draft)
  if (m.kind === 'idle') return null
  if (m.kind === 'delete') {
    if (!sel) return null
    return (
      <Callout tone="danger" title="휴지통으로 옮길까요?" icon="delete">
        <Stack gap="xs">
          <Text size="sm" truncate>{sel.path}</Text>
          <Row gap="xs">
            <Button tone="danger" size="sm" onPress={deleteSelected}>휴지통으로 이동</Button>
            <Button variant="ghost" size="sm" onPress={cancelMode}>취소</Button>
          </Row>
        </Stack>
      </Callout>
    )
  }
  const spec =
    m.kind === 'addRoot'
      ? { label: '폴더 경로', placeholder: '~/Downloads', submit: '추가', run: (v: string) => addRoot(v) }
      : m.kind === 'rename'
        ? { label: '새 이름', placeholder: '', submit: '바꾸기', run: (v: string) => renameSelected(v) }
        : {
            label: m.type === 'dir' ? '새 폴더 이름' : '새 파일 이름',
            placeholder: m.type === 'dir' ? 'folder' : 'file.ts',
            submit: '만들기',
            run: (v: string) => createEntry(v, m.type)
          }
  return (
    <Card title={spec.label} description={m.kind === 'addRoot' ? '워크스페이스 밖의 폴더도 볼 수 있습니다.' : sel ? (m.kind === 'rename' ? sel.path : `위치: ${sel.dir ? sel.path : parentOf(sel.path)}`) : undefined}>
      <Stack gap="xs">
        <Input
          label={spec.label}
          labelHidden
          placeholder={spec.placeholder}
          value={value}
          onChange={(v) => set(draft, v)}
          onSubmit={(v) => void spec.run(v)}
        />
        <Row gap="xs">
          <Button size="sm" disabled={value.trim() === ''} onPress={() => spec.run(read(draft))}>{spec.submit}</Button>
          <Button variant="ghost" size="sm" onPress={cancelMode}>취소</Button>
        </Row>
      </Stack>
    </Card>
  )
}

function Message() {
  const msg = read(message)
  if (!msg) return null
  return (
    <Callout tone={msg.tone}>
      <Row justify="between" align="center">
        <Text size="sm">{msg.text}</Text>
        <IconButton icon="close" label="알림 닫기" variant="ghost" size="xs" onPress={() => set(message, null)} />
      </Row>
    </Callout>
  )
}

function SearchResults() {
  const s = read(search)
  if (s.status === 'idle') return <Text muted size="sm">2자 이상 입력하거나 Enter를 누르세요.</Text>
  if (s.status === 'loading') return <Spinner label="검색 중" />
  if (s.status === 'error') return <Callout tone="danger" title="검색 실패">{s.message}</Callout>
  if (s.hits.length === 0) return <EmptyState title="결과 없음" description={`"${s.query}"와 일치하는 이름이 없습니다.`} icon="search" />
  const sel = read(selection)
  const labels = new Map((read(roots) ?? []).map((r) => [r.id, r.label]))
  return (
    <Stack gap="xs">
      <List label={`검색 결과 ${s.hits.length}${s.truncated ? '+' : ''}개`}>
        {s.hits.map((hit) => {
          const relDir = hit.rel.includes('/') ? hit.rel.slice(0, hit.rel.lastIndexOf('/')) : ''
          return (
            <ListItem
              title={baseName(hit.path)}
              description={[labels.get(hit.rootId), relDir].filter(Boolean).join(' · ')}
              icon={hit.dir ? 'folder' : 'file'}
              current={sel?.rootId === hit.rootId && sel.path === hit.path}
              onPress={() => select({ rootId: hit.rootId, path: hit.path, dir: hit.dir, isRoot: false })}
            />
          )
        })}
      </List>
      {s.truncated ? <Text muted size="xs">결과가 많아 앞쪽 200개만 보여줍니다. 검색어를 더 구체적으로 입력하세요.</Text> : null}
    </Stack>
  )
}

function TreeView() {
  const all = read(roots)
  const error = read(rootsError)
  if (error) {
    return (
      <Callout tone="danger" title="워크스페이스 목록을 읽지 못했습니다">
        <Stack gap="xs">
          <Text size="sm">{error}</Text>
          <Button size="sm" onPress={refreshAll}>다시 시도</Button>
        </Stack>
      </Callout>
    )
  }
  if (all === null) return <Skeleton lines={6} label="불러오는 중" />
  if (all.length === 0) {
    return <EmptyState title="표시할 루트가 없습니다" description="+ 버튼으로 폴더 경로를 추가하세요." icon="folder" />
  }
  const sel = read(selection)
  return (
    <Tree
      label="파일 트리"
      maxHeight="lg"
      items={buildTree(all, read(dirs), read(currentWorkspaceId))}
      expanded={expandedKeys(all, read(expanded), read(collapsedGroups))}
      selected={sel ? nodeKey(sel.rootId, sel.path) : undefined}
      onToggle={({ key, expanded: open }) => toggle(key, open)}
      onSelect={({ key }) => selectKey(key)}
      onAction={({ key }) => activateKey(key)}
    />
  )
}

function Details() {
  const sel = read(selection)
  if (!sel) return null
  const p = read(preview)
  const searching = read(query).trim() !== ''
  const root = (read(roots) ?? []).find((r) => r.id === sel.rootId)
  return (
    <Card title={baseName(sel.path) || sel.path} description={sel.path}>
      <Stack gap="sm">
        <Row gap="xs" wrap>
          {!sel.dir ? (
            <Button size="sm" icon="open-external" onPress={() => openFile(sel)} tooltip={root?.kind === 'custom' ? '워크스페이스 안의 파일만 탭으로 열립니다' : undefined}>
              Orca에서 열기
            </Button>
          ) : null}
          {searching ? <Button size="sm" variant="outline" icon="next" onPress={() => reveal(sel)}>트리에서 보기</Button> : null}
        </Row>
        {sel.dir ? null : p.status === 'loading' ? (
          <Skeleton lines={8} label="미리보기 불러오는 중" />
        ) : p.status === 'error' ? (
          <Text tone="danger" size="sm">{p.message}</Text>
        ) : p.status === 'ready' && p.preview.kind === 'text' ? (
          <Stack gap="xs">
            <CodeView code={p.preview.text ?? ''} language={p.preview.language} label="미리보기" lineNumbers maxHeight="lg" />
            <Text muted size="xs">
              {formatSize(p.preview.size)}{p.preview.truncated ? ' · 앞부분만 표시합니다' : ''}
            </Text>
          </Stack>
        ) : p.status === 'ready' && p.preview.kind === 'binary' ? (
          <Text muted size="sm">바이너리 파일이라 미리볼 수 없습니다 ({formatSize(p.preview.size)}).</Text>
        ) : p.status === 'ready' ? (
          <Text muted size="sm">파일이 커서({formatSize(p.preview.size)}) 미리보기를 건너뜁니다. 설정에서 한도를 바꿀 수 있습니다.</Text>
        ) : null}
      </Stack>
    </Card>
  )
}

export default function Panel() {
  return (
    <Stack gap="sm">
      <Actions />
      <SearchBar />
      <Message />
      <ModeForm />
      {read(query).trim() ? <SearchResults /> : <TreeView />}
      <Switch label="무시된 파일 표시" checked={read(showIgnored)} onChange={setShowIgnored} />
      <Details />
    </Stack>
  )
}
