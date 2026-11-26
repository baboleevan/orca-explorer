// orca CLI 호출. 플러그인 host API 에는 "폴더를 프로젝트로 추가" 가 없어서, 워크스페이스 밖 폴더의
// 파일을 탭으로 열 때만 `orca repo add --kind folder` 를 부른다.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** CLI 위치 후보: ORCA_CLI, 실행 중인 Orca.app 번들, 흔한 설치 경로, PATH. */
export function orcaCliCandidates(): string[] {
  const out: string[] = []
  if (process.env.ORCA_CLI) out.push(process.env.ORCA_CLI)
  const app = process.execPath.match(/^(.*?\.app)\//)?.[1]
  if (app) out.push(join(app, 'Contents/Resources/bin/orca'))
  out.push(
    '/Applications/Orca.app/Contents/Resources/bin/orca',
    join(homedir(), 'Applications/Orca.app/Contents/Resources/bin/orca'),
    '/usr/local/bin/orca',
    '/opt/homebrew/bin/orca',
    join(homedir(), '.local/bin/orca')
  )
  return out
}

export function findOrcaCli(): string {
  return orcaCliCandidates().find((p) => existsSync(p)) ?? 'orca'
}

export type CliResult = { ok: boolean; output: string }

export function runOrcaCli(args: string[], timeoutMs = 20000): Promise<CliResult> {
  const cli = findOrcaCli()
  return new Promise((resolve) => {
    execFile(
      cli,
      [...args, '--json'],
      // Orca.app 에서 띄운 worker 는 PATH 가 짧을 수 있어 CLI 가 쓰는 node 를 찾도록 보탠다.
      { timeout: timeoutMs, env: { ...process.env, PATH: `${dirname(cli)}:${process.env.PATH ?? '/usr/bin:/bin'}` } },
      (error, stdout) => {
        let ok = !error
        try {
          ok = JSON.parse(stdout).ok === true
        } catch {
          /* JSON 이 아니면 종료 코드로 판단 */
        }
        resolve({ ok, output: String(stdout || error?.message || '') })
      }
    )
  })
}
