// 파일 조작: 새 파일/폴더, 이름 변경, 휴지통으로 삭제. 경로 검사는 호출 쪽(paths.ts)에서 끝낸 뒤 온다.
import { access, mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { ExplorerError, validateName } from './paths'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function failed(error: unknown, what: string): ExplorerError {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EEXIST') return new ExplorerError('conflict', `이미 있습니다: ${what}`)
  if (code === 'EACCES' || code === 'EPERM') return new ExplorerError('not_permitted', `권한이 없습니다: ${what}`)
  return new ExplorerError('action_failed', `${what}: ${(error as Error).message}`)
}

export async function createEntry(path: string, kind: 'file' | 'dir'): Promise<string> {
  try {
    if (kind === 'dir') await mkdir(path)
    else await writeFile(path, '', { flag: 'wx' }) // wx: 이미 있으면 EEXIST
  } catch (error) {
    throw failed(error, basename(path))
  }
  return path
}

export async function renameEntry(path: string, newName: string): Promise<string> {
  const target = join(dirname(path), validateName(newName))
  if (target === path) return path
  // 대소문자만 바뀌는 경우(macOS 기본 파일시스템)는 같은 파일이므로 충돌로 보지 않는다.
  if (target.toLowerCase() !== path.toLowerCase() && (await exists(target))) {
    throw new ExplorerError('conflict', `같은 이름이 이미 있습니다: ${newName}`)
  }
  try {
    await rename(path, target)
  } catch (error) {
    throw failed(error, basename(path))
  }
  return target
}

/** 휴지통 폴더: macOS ~/.Trash, 그 외 XDG ~/.local/share/Trash/files. */
export function trashDir(): string {
  return process.platform === 'darwin' ? join(homedir(), '.Trash') : join(homedir(), '.local/share/Trash/files')
}

/** 같은 이름이 있으면 "이름 2.ext", "이름 3.ext" … 로 비켜 간다. */
async function freeName(dir: string, name: string): Promise<string> {
  let candidate = join(dir, name)
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let n = 2; await exists(candidate); n++) candidate = join(dir, `${stem} ${n}${ext}`)
  return candidate
}

export async function trashEntry(path: string, trash = trashDir()): Promise<string> {
  try {
    await mkdir(trash, { recursive: true })
  } catch (error) {
    throw failed(error, '휴지통')
  }
  const target = await freeName(trash, basename(path))
  try {
    await rename(path, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
      // 다른 볼륨: 영구 삭제로 몰래 바꾸지 않고 사용자에게 알린다.
      throw new ExplorerError('action_failed', '다른 볼륨의 파일이라 휴지통으로 옮길 수 없습니다. Finder에서 삭제하세요.')
    }
    throw failed(error, basename(path))
  }
  return target
}
