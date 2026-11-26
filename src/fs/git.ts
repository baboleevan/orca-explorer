// git 을 자식 프로세스로 실행하는 작은 헬퍼. git 이 없거나 저장소가 아니면 code 가 0 이 아니다.
import { spawn } from 'node:child_process'

export type GitResult = { code: number; stdout: string }

export function runGit(
  cwd: string,
  args: string[],
  options: { input?: string; signal?: AbortSignal; maxBytes?: number } = {}
): Promise<GitResult> {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('git', ['-C', cwd, ...args], {
        stdio: ['pipe', 'pipe', 'ignore'],
        signal: options.signal,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
      })
    } catch {
      resolve({ code: -1, stdout: '' })
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    child.stdout.on('data', (chunk: Buffer) => {
      if (size >= maxBytes) return
      size += chunk.length
      chunks.push(chunk)
      if (size >= maxBytes) child.kill()
    })
    child.on('error', () => resolve({ code: -1, stdout: '' }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout: Buffer.concat(chunks).toString('utf8') }))
    child.stdin.on('error', () => {})
    child.stdin.end(options.input ?? '')
  })
}
