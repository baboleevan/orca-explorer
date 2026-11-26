# Workspace Explorer

Orca 오른쪽 사이드바 패널에서 **모든 워크스페이스**와 **원하는 아무 경로**를 Finder처럼 탐색하고, 파일을 Orca 기본 "파일" 탭처럼 메인 창 탭으로 열어 읽고·수정·삭제하는 플러그인입니다.

## 설치

```sh
orca plugin install baboleevan/orca-explorer
```

코드를 실행하는 플러그인이라 처음에는 `approval_required`로 멈추고 요구하는 권한과 fingerprint를 보여줍니다.
내용을 확인한 뒤 출력된 명령(`--approve <fingerprint>`)으로 다시 실행하면 설치됩니다. 패널은 오른쪽 사이드바의 폴더 아이콘입니다.

## 기능

- **클릭하면 탭으로 열기:** 파일을 한 번 클릭하면 Orca 메인 창에 탭으로 열립니다. 다른 워크스페이스의 파일이면 그 워크스페이스로 화면을 옮겨서 엽니다(Orca 의 탭은 워크스페이스마다 따로 있습니다).
- **Finder 식 위치 이동:** 위쪽 위치 입력창에 경로(`~/Downloads` 처럼 `~` 가능)를 넣거나 폴더를 더블클릭하면 그 폴더의 내용만 보입니다. 상위 폴더 · 모든 워크스페이스 · 즐겨찾기 추가 버튼이 있습니다.
- **모든 워크스페이스 트리:** 프로젝트별로 묶고 현재 워크스페이스에 "현재" 표시. Orca 사이드바에서 숨긴 프로젝트는 빠집니다.
- **파일 조작:** 새 파일·새 폴더·이름 변경·삭제(휴지통으로 이동). 아무것도 고르지 않으면 현재 위치에 만듭니다.
- **검색:** 2자 이상 입력하거나 Enter. `/` 를 넣으면 경로로 검색. 위치 모드에선 그 폴더 안에서만 찾습니다.
- **`.gitignore` 숨김:** git 저장소가 아니면 `node_modules` 등 기본 목록. "무시된 파일 표시"로 전환합니다.

## 워크스페이스 밖 파일

Orca 는 등록된 워크스페이스 안의 파일만 탭으로 열 수 있습니다. 그래서 워크스페이스 밖 파일을 처음 열 때 보고 있던 위치 폴더를
**Orca 폴더 프로젝트로 등록**(`orca repo add --kind folder`)한 뒤 탭으로 엽니다. 등록된 폴더는 Orca 사이드바에 프로젝트로 보입니다.
`/`, 홈, `/Users` 처럼 너무 넓은 폴더는 등록하지 않고 파일이 든 폴더를 대신 등록하며, 홈 바로 아래 파일(예: `~/.zshrc`)은 열지 않습니다.

## 제약

- SSH·원격 런타임 워크스페이스는 비활성으로 표시됩니다(worker 가 로컬 파일시스템만 읽음).
- 다른 볼륨의 파일은 휴지통으로 옮길 수 없어서 오류를 보여줍니다. 몰래 영구 삭제로 바꾸지 않습니다.
- 파일 변경 감시는 아직 없습니다. 이 패널이 아닌 곳에서 바꾼 내용은 새로고침 버튼으로 반영합니다.

## 설정 (Settings → Plugins → Workspace Explorer)

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `showIgnored` | `false` | 무시된 파일 표시 |
| `maxEntriesPerDir` | `500` | 폴더당 최대 항목 수 |

## 구조

```
src/protocol.ts     패널 ↔ worker 요청 계약
src/types.ts        공유 데이터 타입
src/worker.ts       요청 처리 (Node)
src/fs/*            경로 가드·목록·무시 판정·검색·파일 조작·orca CLI 호출
src/panel.tsx       components 패널 UI
src/panel/*         atom 상태, 트리 변환, 동작
```

모든 fs 요청은 `src/fs/paths.ts`의 가드를 거칩니다. 경로는 요청한 루트(워크스페이스·즐겨찾기·현재 위치) 안이어야 하고, 루트 밖을 가리키는 심볼릭 링크와 `..` 탈출은 거부합니다.

## 개발

```sh
./scripts/typecheck.sh      # 타입 검사 (typescript·@types/node 를 ~/.cache 에 한 번 설치)
orca plugin test . --json   # fs·worker·패널 테스트
orca plugin check . --json  # 시나리오 렌더 검사 (src/panel.check.ts)
orca plugin dev watch . --check --shot ./.orca/shots --json
```

Orca 는 플러그인 폴더 안의 `node_modules`(숨김 폴더 안이어도)를 콘텐츠로 보고 심볼릭 링크 때문에 거부합니다.
그래서 이 폴더에서는 `npm install` 을 하지 않습니다.
