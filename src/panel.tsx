// Workspace Explorer 패널. 빌드 없이 Orca 가 TSX 를 변환한다. 상태는 src/panel/state.ts 의 atom 에 있다.
import {
  Box,
  Button,
  Callout,
  Card,
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
  baseName,
  cancelMode,
  clearQuery,
  createEntry,
  createTarget,
  deleteSelected,
  goUp,
  invalidate,
  loadRoots,
  navigate,
  refreshAll,
  reloadExpanded,
  removeRoot,
  renameSelected,
  select,
  selectKey,
  setLocation,
  setScope,
  setShowIgnored,
  startMode,
  toggleBookmark,
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
  locId,
  location,
  locationDraft,
  message,
  mode,
  nodeKey,
  query,
  roots,
  rootsError,
  search,
  searchScope,
  selection,
  showIgnored
} from './panel/state'
import { buildLocationTree, buildTree, expandedKeys } from './panel/tree'

export function setup(ctx: PanelContext): void {
  set(locationDraft, read(location) ?? '')
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
    })
  )
}

/** 위치 바: 상위 폴더 · 모든 워크스페이스 · 즐겨찾기 토글 · 경로 입력, 그 아래 즐겨찾기 드롭다운. */
function LocationBar() {
  const loc = read(location)
  const bookmarks = (read(roots) ?? []).filter((r) => r.kind === 'custom')
  const bookmarked = loc !== null && bookmarks.some((r) => r.path === loc)
  return (
    <Stack gap="xs">
      <Row gap="xs" align="center">
        <IconButton icon="collapse" label="상위 폴더" tooltip="상위 폴더" variant="ghost" size="sm" disabled={loc === null || loc === '/'} onPress={goUp} />
        <IconButton icon="layers" label="모든 워크스페이스" tooltip="모든 워크스페이스 보기" variant="ghost" size="sm" disabled={loc === null} onPress={() => setLocation(null)} />
        <IconButton
          icon="star"
          label={bookmarked ? '즐겨찾기에서 빼기' : '즐겨찾기에 추가'}
          tooltip={loc === null ? '폴더로 이동한 뒤 즐겨찾기할 수 있습니다' : bookmarked ? '즐겨찾기에서 빼기' : '이 위치를 즐겨찾기에 추가'}
          variant={bookmarked ? 'solid' : 'ghost'}
          tone={bookmarked ? 'accent' : undefined}
          size="sm"
          disabled={loc === null}
          onPress={toggleBookmark}
        />
        <Box grow>
          <Input
            label="위치"
            labelHidden
            placeholder="경로로 이동 (예: ~/Downloads) · 비우면 모든 워크스페이스"
            value={read(locationDraft)}
            onChange={(v) => set(locationDraft, v)}
            onSubmit={navigate}
          />
        </Box>
      </Row>
      {bookmarks.length > 0 ? (
        <Select
          label="즐겨찾기"
          labelHidden
          placeholder={`즐겨찾기로 이동… (${bookmarks.length}개)`}
          value={bookmarked && loc ? loc : ''}
          options={bookmarks.map((r) => ({ value: r.path, label: r.path }))}
          onChange={(path) => void setLocation(path)}
        />
      ) : null}
    </Stack>
  )
}

function Actions() {
  const sel = read(selection)
  const root = sel ? (read(roots) ?? []).find((r) => r.id === sel.rootId) : undefined
  const canCreate = createTarget() !== null
  const itemOps = sel !== null && !sel.isRoot
  return (
    <Toolbar label="파일 도구" gap="xs">
      <IconButton icon="refresh" label="새로고침" tooltip="새로고침" variant="ghost" size="sm" onPress={refreshAll} />
      <IconButton icon="file" label="새 파일" tooltip="새 파일" variant="ghost" size="sm" disabled={!canCreate} onPress={() => startMode({ kind: 'create', type: 'file' })} />
      <IconButton icon="folder" label="새 폴더" tooltip="새 폴더" variant="ghost" size="sm" disabled={!canCreate} onPress={() => startMode({ kind: 'create', type: 'dir' })} />
      <IconButton icon="edit" label="이름 변경" tooltip="이름 변경" variant="ghost" size="sm" disabled={!itemOps} onPress={() => startMode({ kind: 'rename' })} />
      <IconButton icon="delete" label="삭제" tooltip="휴지통으로 이동" variant="ghost" size="sm" tone={itemOps ? 'danger' : undefined} disabled={!itemOps} onPress={() => startMode({ kind: 'delete' })} />
      <IconButton icon="next" label="이 폴더로 이동" tooltip="선택한 폴더로 이동 (더블클릭과 같음)" variant="ghost" size="sm" disabled={!sel?.dir} onPress={() => sel && setLocation(sel.path)} />
      {sel?.isRoot && root?.kind === 'custom' ? (
        <IconButton icon="remove" label="즐겨찾기에서 빼기" tooltip="즐겨찾기에서 빼기 (파일은 그대로)" variant="ghost" size="sm" onPress={() => removeRoot(root.id)} />
      ) : null}
    </Toolbar>
  )
}

function SearchBar() {
  const loc = read(location)
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
        placeholder={loc ? '이 위치에서 파일 이름 검색' : '파일 이름 검색 (경로는 / 포함)'}
        value={read(query)}
        onChange={typeQuery}
        onSubmit={submitQuery}
      />
      {read(query) ? (
        <Row gap="xs" align="center">
          <Box grow>
            {loc ? (
              <Text muted size="xs" truncate>범위: {loc}</Text>
            ) : (
              <Select
                label="검색 범위"
                labelHidden
                value={scopeOptions.some((o) => o.value === scope) ? scope : 'all'}
                options={scopeOptions}
                onChange={setScope}
              />
            )}
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
  const target = createTarget()
  const spec =
    m.kind === 'rename'
      ? { label: '새 이름', placeholder: '', submit: '바꾸기', where: sel?.path, run: (v: string) => renameSelected(v) }
      : {
          label: m.type === 'dir' ? '새 폴더 이름' : '새 파일 이름',
          placeholder: m.type === 'dir' ? 'folder' : 'file.ts',
          submit: '만들기',
          where: target ? `위치: ${target.dir}` : undefined,
          run: (v: string) => createEntry(v, m.type)
        }
  return (
    <Card title={spec.label} description={spec.where}>
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
              onPress={() =>
                hit.dir ? setLocation(hit.path) : select({ rootId: hit.rootId, path: hit.path, dir: false, isRoot: false })
              }
            />
          )
        })}
      </List>
      {s.truncated ? <Text muted size="xs">결과가 많아 앞쪽 200개만 보여줍니다. 검색어를 더 구체적으로 입력하세요.</Text> : null}
    </Stack>
  )
}

/** 위치 모드: 그 폴더의 내용만. */
function LocationView({ path }: { path: string }) {
  const state = read(dirs)[nodeKey(locId(path), path)]
  if (state?.status === 'error') return <Callout tone="danger" title="폴더를 읽지 못했습니다">{state.message}</Callout>
  const items = buildLocationTree(path, read(dirs))
  if (items === null) return <Skeleton lines={6} label="불러오는 중" />
  if (items.length === 0) return <EmptyState title="빈 폴더" description={path} icon="folder" />
  const sel = read(selection)
  return (
    <Tree
      label="파일 트리"
      maxHeight="none"
      items={items}
      expanded={read(expanded)}
      selected={sel ? nodeKey(sel.rootId, sel.path) : undefined}
      onToggle={({ key, expanded: open }) => toggle(key, open)}
      onSelect={({ key }) => selectKey(key)}
      onAction={({ key }) => activateKey(key)}
    />
  )
}

function WorkspacesView() {
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
    return <EmptyState title="표시할 워크스페이스가 없습니다" description="위치 입력창에 경로를 넣어 이동하세요." icon="folder" />
  }
  const sel = read(selection)
  return (
    <Tree
      label="파일 트리"
      maxHeight="none"
      items={buildTree(all, read(dirs), read(currentWorkspaceId))}
      expanded={expandedKeys(all, read(expanded), read(collapsedGroups))}
      selected={sel ? nodeKey(sel.rootId, sel.path) : undefined}
      onToggle={({ key, expanded: open }) => toggle(key, open)}
      onSelect={({ key }) => selectKey(key)}
      onAction={({ key }) => activateKey(key)}
    />
  )
}

export default function Panel() {
  const loc = read(location)
  return (
    // 위쪽 도구는 고정하고, 트리 영역이 남은 높이를 모두 차지하며 그 안에서만 스크롤한다.
    <Box direction="column" gap="sm" height="100%">
      <LocationBar />
      <Actions />
      <SearchBar />
      <Message />
      <ModeForm />
      <Box grow minHeight={0} scroll="y">
        {read(query).trim() ? <SearchResults /> : loc ? <LocationView path={loc} /> : <WorkspacesView />}
      </Box>
      <Row justify="between" align="center">
        <Text muted size="xs">클릭: 탭으로 열기 · 더블클릭: 폴더로 이동</Text>
        <Switch label="무시된 파일 표시" checked={read(showIgnored)} onChange={setShowIgnored} />
      </Row>
    </Box>
  )
}
