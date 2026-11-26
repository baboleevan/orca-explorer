// fs 모듈 단위 테스트: 실제 임시 디렉터리에서 돌린다.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, beforeEach, test } from 'orca/testing'
import { listDir } from './list'
import { createEntry, renameEntry, trashEntry } from './ops'
import { ExplorerError, expandPath, resolveChild, resolveExisting, validateName } from './paths'
import { projectDirFor, tooBroad } from './roots'
import { listAll, matchEntries } from './search'

let base = ''
let root = ''

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'wsx-')))
  root = join(base, 'root')
  await mkdir(join(root, 'src/nested'), { recursive: true })
  await mkdir(join(root, 'node_modules/pkg'), { recursive: true })
  await writeFile(join(root, 'src/app.ts'), 'export const a = 1\n')
  await writeFile(join(root, 'src/nested/App.test.ts'), '')
  await writeFile(join(root, 'README.md'), '# hi\n')
  await writeFile(join(root, 'file10.txt'), '')
  await writeFile(join(root, 'file2.txt'), '')
  await writeFile(join(base, 'outside.txt'), 'secret')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function git(...args: string[]) {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' })
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof ExplorerError && error.code === code)
}

test('listDir: 폴더 먼저, 자연 정렬, 비 git 기본 무시 목록', async () => {
  const { entries, truncated } = await listDir(root, { showIgnored: false, limit: 100 })
  assert.deepEqual(
    entries.map((e) => `${e.dir ? 'd' : 'f'}:${e.name}`),
    ['d:src', 'f:file2.txt', 'f:file10.txt', 'f:README.md']
  )
  assert.equal(truncated, 0)
})

test('listDir: showIgnored 면 node_modules 도 보이고 .git 은 항상 숨김', async () => {
  git('init', '-q')
  const { entries } = await listDir(root, { showIgnored: true, limit: 100 })
  const names = entries.map((e) => e.name)
  assert.ok(names.includes('node_modules'))
  assert.ok(!names.includes('.git'))
})

test('listDir: git 저장소면 .gitignore 를 따른다', async () => {
  git('init', '-q')
  await writeFile(join(root, '.gitignore'), 'README.md\n')
  const names = (await listDir(root, { showIgnored: false, limit: 100 })).entries.map((e) => e.name)
  assert.ok(!names.includes('README.md'))
  assert.ok(!names.includes('.git'))
  assert.ok(names.includes('node_modules'), 'gitignore 에 없으면 node_modules 도 보인다')
  assert.ok(names.includes('.gitignore'))
})

test('listDir: 상한을 넘으면 자르고 남은 개수를 알려준다', async () => {
  const { entries, truncated } = await listDir(root, { showIgnored: false, limit: 2 })
  assert.equal(entries.length, 2)
  assert.equal(truncated, 2)
})

test('resolveExisting: 루트 안은 허용, .. 탈출과 바깥 링크는 거부', async () => {
  assert.equal(await resolveExisting(root, join(root, 'src/app.ts')), join(root, 'src/app.ts'))
  assert.equal(await resolveExisting(root, 'src'), join(root, 'src'))
  await rejectsWith(resolveExisting(root, join(root, '../outside.txt')), 'not_permitted')
  await symlink(join(base, 'outside.txt'), join(root, 'link.txt'))
  await rejectsWith(resolveExisting(root, join(root, 'link.txt')), 'not_permitted')
  await rejectsWith(resolveExisting(root, join(root, 'missing')), 'invalid_params')
})

test('expandPath / validateName', () => {
  assert.ok(!expandPath('~/x').startsWith('~'))
  assert.throws(() => expandPath('relative/path'))
  assert.throws(() => validateName('a/b'))
  assert.throws(() => validateName('..'))
  assert.equal(validateName(' ok.txt '), 'ok.txt')
})

test('ops: 생성 → 충돌 → 이름 변경 → 휴지통', async () => {
  const file = await resolveChild(root, join(root, 'src'), 'new.ts')
  await createEntry(file, 'file')
  await rejectsWith(createEntry(file, 'file'), 'conflict')
  await createEntry(await resolveChild(root, root, 'dir'), 'dir')

  await rejectsWith(renameEntry(file, 'app.ts'), 'conflict')
  const renamed = await renameEntry(file, 'renamed.ts')
  assert.equal(renamed, join(root, 'src/renamed.ts'))

  const trash = join(base, 'trash')
  await writeFile(join(root, 'dup.txt'), '1')
  const first = await trashEntry(join(root, 'dup.txt'), trash)
  await writeFile(join(root, 'dup.txt'), '2')
  const second = await trashEntry(join(root, 'dup.txt'), trash)
  assert.equal(first, join(trash, 'dup.txt'))
  assert.equal(second, join(trash, 'dup 2.txt'))
  assert.deepEqual((await readdir(trash)).sort(), ['dup 2.txt', 'dup.txt'])
})

test('projectDirFor: 너무 넓은 폴더는 파일이 든 폴더로, 그래도 넓으면 거부', () => {
  const home = '/Users/me'
  assert.ok(tooBroad('/', home) && tooBroad('/Users', home) && tooBroad(home, home))
  assert.ok(!tooBroad('/Users/me/Downloads', home))
  assert.equal(projectDirFor('/Users/me/Downloads', '/Users/me/Downloads/a/b.txt', home), '/Users/me/Downloads')
  assert.equal(projectDirFor('/', '/etc/hosts', home), '/etc')
  assert.equal(projectDirFor(home, '/Users/me/notes/a.md', home), '/Users/me/notes')
  assert.throws(() => projectDirFor(home, '/Users/me/.zshrc', home))
})

test('search: git ls-files 와 BFS 모두 이름으로 찾는다', async () => {
  const walked = await listAll(root, { showIgnored: false })
  assert.ok(walked)
  assert.deepEqual(matchEntries(walked!, 'app').map((m) => m.rel), ['src/app.ts', 'src/nested/App.test.ts'])
  assert.ok(!walked!.some((m) => m.rel.startsWith('node_modules')))

  git('init', '-q')
  await writeFile(join(root, '.gitignore'), 'file*.txt\n')
  const tracked = await listAll(root, { showIgnored: false })
  assert.deepEqual(matchEntries(tracked!, 'file').map((m) => m.rel), [])
  assert.deepEqual(matchEntries(tracked!, 'nested').map((m) => `${m.dir}:${m.rel}`), ['true:src/nested'])
  assert.deepEqual(matchEntries(tracked!, 'src/n').map((m) => m.rel)[0], 'src/nested')
})
