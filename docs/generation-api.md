# 생성 세션 API 구현 및 실행 안내

기준: 사용자 제공 `26.10.28 API 명세서.md` (아이디어 보조 API **추가** 명세).

## 구현 범위

첨부 문서의 다시 생성·발전·구체화 API를 실제 HTTP 서버로 구현했다. 원문은 전체 서버 명세가 아니므로, 실행에 필요한 세션 준비·조회·최초 생성·취소 경로도 추가했다. 기존에 사용하지 않던 `server/server.js`는 실행하거나 수정하지 않는다. 현재 진입점은 새 `api/server.js`다.

**기존 React 웹과 Kotlin Android는 외부 AI를 직접 호출하는 기존 방식 그대로다. 새 API를 사용하도록 자동 전환하지 않았다. Render의 정적 사이트에 이 서버가 배포된 것은 아니다.** 이 작업은 첨부된 추가 API의 로컬 구현이며, 회원·보관함·DB·기존 노션 서버 설계 전체의 구현을 뜻하지 않는다. Git에 코드를 공유해도 정적 사이트에 API 서버가 자동 배포되지는 않는다. Render 서비스 설정은 변경하지 않았다.

## 기술 선택과 구성

- Node.js 내장 HTTP 서버·fetch·crypto, 추가 설치 패키지 없음. 프로젝트의 Node 최소 버전 22.13.0 유지.
- 메모리 `Map`: 세션·아이디어 이력·요청 기록. DB와 파일 저장 없음. 재시작하면 모두 사라짐.
- 모델: 기존 프로젝트의 Gemini / OpenAI 모델·고정 HTTPS 주소를 재사용. 요청 JSON 검증은 기존 공통 모듈 재사용.
- 외부 모델 API 키는 서버 환경변수 전용. 요청 본문으로 키·모델·임의 주소를 받지 않으며 로그·응답·저장 데이터에 포함하지 않음.
- 키 없이 검증할 때만 `--demo`로 규칙 시연 모드를 명시적으로 선택. AI 오류 때 자동 대체하지 않음.

```text
로컬 HTTP 클라이언트
  → 요청·세션 토큰·소속·중복 검증
  → 세션 작업 잠금 + 취소/시간 초과
  → Gemini/OpenAI(HTTPS) 또는 명시적 규칙 시연
  → JSON·단어·반복 결과 검증
  → 검증 성공 시에만 메모리 결과 반영
```

## 실행

프로젝트 폴더에서 실행한다. 아래 규칙 시연과 자동 점검에는 API 키나 유료 호출이 필요 없다.

```powershell
npm run api:demo
```

- 상태: `http://127.0.0.1:4000/v1/health`
- 전체 OpenAPI 3.1 계약: `http://127.0.0.1:4000/v1/openapi.json`
- 종료: 실행 창에서 Ctrl+C. 포트 변경은 `IDEA_API_PORT` 환경변수 사용.
- 상태 `ok`는 프로세스 응답만 뜻한다. 외부 AI 인증·요금·모델 접근 성공을 확인한 것은 아니다.

한 번 실행하고 끝나는 실제 HTTP 흐름 점검:

```powershell
npm run api:smoke
npm test
```

실제 AI를 사용할 경우:

```powershell
Copy-Item api/env.example .env.api.local
```

직접 `.env.api.local`을 열고 `IDEA_API_PROVIDER=gemini`, 본인 `GEMINI_API_KEY`를 입력한다. OpenAI는 `IDEA_API_PROVIDER=openai`와 `OPENAI_API_KEY`를 사용한다. 실제 키를 채팅이나 소스 파일에 붙여 넣지 않는다. 이 파일은 `.gitignore`의 `.env.*` 규칙으로 제외되지만, 공유·압축·화면 노출은 별도로 주의해야 한다.

```powershell
npm run api:local
```

이미 환경변수를 설정했다면 `npm run api:start`도 가능하다. 기본 제공업체는 Gemini이며 키가 없으면 생성 요청에 `503 AI_NOT_CONFIGURED`를 반환한다. 모델 이용료와 인터넷 연결이 필요하다.

## 데이터 목록

| 데이터 | 주요 필드 | 수명 |
|---|---|---|
| 생성 세션 | id, categoryId, category, topic, words[3], condition, currentIdeaId, expiresAt | 마지막 작업 완료부터 1시간 |
| 세션 소유 토큰 | 생성 시 sessionToken 1회 제공, 서버에는 SHA-256 해시만 보관 | 해당 세션과 동일 |
| 아이디어 | id, parentIdeaId, revision, title, one_liner, description, steps[3], word_links, used_words, condition, source, model | 세션 메모리 |
| 발전 결과 | 아이디어 필드 + direction, what_changed | 새 아이디어 ID로 이력 보존 |
| 구체화 | ideaId, revision, target_user, problem, value, core_features[3], first_prototype, risks, source, model | 기존 아이디어의 elaboration 갱신 |
| 요청 기록 | Idempotency-Key, 작업·본문 식별자, pending/done, 성공 결과 또는 안전한 오류 | 세션 만료까지, 최대 100회 |

회원 ID나 DB가 없으므로 토큰은 **익명 세션의 소유 증명**일 뿐 회원 인증·역할 권한 시스템이 아니다. 토큰을 가진 사람은 해당 세션에 접근할 수 있다. 토큰도 키처럼 URL·스크린샷·로그에 노출하지 않는다.

## API 목록

| 메서드·경로 | 본문 | 성공 data |
|---|---|---|
| GET /v1/health | 없음 | 상태·모델 출처·memory 저장 표시 |
| GET /v1/openapi.json | 없음 | OpenAPI 문서 자체(이 경로만 봉투 없음) |
| POST /v1/generation-sessions | categoryId, 선택 topic·words·condition | 세션 + sessionToken (201) |
| GET /v1/generation-sessions/{id} | 없음 | 컨텍스트·아이디어 이력·진행 요청 키 |
| POST /v1/generation-sessions/{id}/generate | `{}` | 첫 아이디어 |
| POST /v1/generation-sessions/{id}/regenerate | `{ "ideaId": "현재 ID" }` | 다른 아이디어 |
| POST /v1/generation-sessions/{id}/develop | `{ "ideaId": "현재 ID", "direction": "realistic" }` | 발전 결과 + 실제 변경 이유 |
| POST /v1/generation-sessions/{id}/elaborate | `{ "ideaId": "현재 ID" }` | 실행 초안 |
| POST /v1/generation-sessions/{id}/cancel | `{ "requestKey": "취소할 요청 키" }` | cancelled: true/false |

세션 ID가 포함된 경로에는 `Authorization: Bearer <sessionToken>` 필수. 생성·다시 생성·발전·구체화에는 `Idempotency-Key`도 필수이며, 취소에는 필수가 아니다. `POST`는 `Content-Type: application/json`을 사용한다.

### 기본 요청 예시

PowerShell에서 규칙 시연 서버를 실행한 뒤 별도 창에서:

```powershell
$apiBase = 'http://127.0.0.1:4000/v1/generation-sessions'
$sessionBody = @{ categoryId = 'food'; words = @('김치', '도시락', '숲'); condition = '1인 가구를 위한 서비스' } | ConvertTo-Json
$created = Invoke-RestMethod -Method Post -Uri $apiBase -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($sessionBody))
$sessionUrl = "$apiBase/$($created.data.id)"
$apiHeaders = @{ Authorization = "Bearer $($created.data.sessionToken)"; 'Idempotency-Key' = [guid]::NewGuid().ToString() }
$first = Invoke-RestMethod -Method Post -Uri "$sessionUrl/generate" -Headers $apiHeaders -ContentType 'application/json' -Body '{}'
$apiHeaders['Idempotency-Key'] = [guid]::NewGuid().ToString()
$requestBody = @{ ideaId = $first.data.id; direction = 'realistic' } | ConvertTo-Json
$developed = Invoke-RestMethod -Method Post -Uri "$sessionUrl/develop" -Headers $apiHeaders -ContentType 'application/json' -Body $requestBody
$developed.data
```

응답은 `{ "data": ..., "meta": { "requestId": "...", "replayed": false } }`다. 오류는 `data` 대신 `{ "error": { "code": "...", "message": "..." }, "meta": ... }`와 비정상 HTTP 상태를 반환한다.

## 동작·실패 규칙

1. 세션의 단어·카테고리·직접 주제·조건은 작업 중 덮어쓸 수 없다. 바꾸려면 새 세션을 만든다. 조건은 선택 사항이며 공백 제거 전 100 UTF-16 단위 제한, 제어·방향 제어문자·깨진 유니코드를 서버에서도 거부한다.
2. 최초 생성은 한 번만 가능하다. 다시 생성·발전에는 새 아이디어 ID와 parentIdeaId를 반환한다. 이후 요청에는 최신 ID를 사용한다. 다른 세션 ID는 404, 같은 세션의 오래된 ID는 409다.
3. 발전 방향은 unique / realistic / fun / premium뿐이다. AI에 핵심 유지와 실제 변경 이유를 요구하며, 실행 단계가 전혀 달라지지 않은 결과는 거부한다. `what_changed`는 AI 응답 필수 필드다.
4. 다시 생성은 같은 제목 또는 같은 설명의 결과를 거부한다. 구체화 재요청은 이전 구체화를 모델에 전달하고 다른 실험을 요구한다. 동일한 first_prototype은 거부한다. 이는 텍스트 검증이며, **핵심 유지·의미상 차별성·조건 충족의 완전한 보장은 아니다.**
5. 같은 키·같은 작업/본문의 성공 재요청은 기존 결과를 반환(`meta.replayed=true`)하고 AI를 재호출하지 않는다. 같은 키·다른 요청은 409, 진행 중 동일 요청도 409다. 실패·취소된 키 재요청도 같은 오류만 반환한다. 의도적으로 재시도할 때는 새 키를 쓴다.
6. 세션당 진행 작업은 1개, 프로세스 전체 동시 작업 4개, 전체 분당 시작 20회, 세션당 기록 100회, 메모리 세션 100개로 제한한다. 한도 초과는 429 또는 503이다. 만료 정리는 새 세션 생성/인증 시 수행한다.
7. AI 응답 대기 제한은 본문 파싱까지 60초다. 명시적 취소와 HTTP 연결 종료는 AbortSignal을 전달한다. 완료·검증 전에는 세션 결과를 갱신하지 않으며, 취소 뒤 늦게 도착한 결과는 버린다. **전송 이후 업체에서 처리한 비용까지 취소되는 것은 아니다.**
8. 입력 검증 400, 토큰 없음 401, 출처/호스트 거부 403, 세션·아이디어 소속 오류 404, 충돌/취소 409, 본문 초과 413, JSON 형식 아님 415, 한도 429, AI 실패/잘못된 결과 502, 키 미설정 503, 시간 초과 504. 내부 오류 500에는 내부 경로나 제공업체 원문을 노출하지 않는다.
9. 로컬 루프백 주소로만 실행하며 허용 웹 출처는 localhost/127.0.0.1의 5180 포트다. 기본 허용 출처에 공개 Render 주소를 추가하지 않았다. 쿠키 인증·와일드카드 CORS를 사용하지 않으며 JSON 본문은 16KB로 제한한다.

## 결정 기록

| 결정 | 이유 |
|---|---|
| 기존 서버 대신 api/ 신설 | 기존 server/는 오래된 미사용·Git 제외 코드이며 자동 규칙 대체를 포함해 새 실패 규칙과 다름 |
| DB 없이 메모리 세션 | 교수님이 제외한 DB를 다시 도입하지 않고 API를 실행·검증하기 위함 |
| 토큰·ID 소속 확인 | 세션 ID나 ideaId만 알면 다른 결과를 바꾸는 문제 방지 |
| 성공 전 일괄 반영 | AI 오류·취소·시간 초과 시 기존 결과 유지 |
| 요청 키 필수·자동 재시도 없음 | 응답 유실·더블 클릭 때문에 모델 사용료가 중복 발생하는 것 방지 |
| 모델별 구조화 응답 + 추가 검증 | 필수 필드와 변경 이유 확보. 형식이 맞아도 내용 품질은 별도 확인 필요 |
| 기존 프런트 자동 전환 안 함 | Render 정적 사이트와 개인 키·온디바이스 실행 흐름을 망가뜨리지 않기 위함 |

## 검증 및 남은 범위

- 2026-11-04: 전체 자동 테스트 98개(신규 API 테스트 14개 포함), HTTP 스모크 검증, 기존 웹 프로덕션 빌드 통과. 모델 키 파일의 Git 제외 규칙도 확인했다.
- `tests/generation-api.test.js`: 실제 로컬 HTTP 서버에서 전체 흐름·4개 발전 방향·세션 소속·중복·동시 요청·취소·연결 종료·시간 초과·잘못된 응답·만료·본문/출처 검증. 모델 HTTP 전송은 가짜 응답으로 확인한다.
- `npm run api:smoke`: 무료 규칙 시연으로 실제 HTTP 세션 생성 → 생성 → 다시 생성 → 발전 → 구체화 확인.
- 유효한 개인 키로 새 서버의 실제 AI 생성·의미 품질을 확인하지 않았다. 키 없이 완료했다고 주장하지 않는다.
- 계정 로그인/RBAC, 영구 DB, 다중 프로세스 잠금·재시작 후 중복 방지, 기존 웹·앱의 새 서버 연결, 공개 서버 배포는 이번 추가 명세의 구현 범위 밖이다. 공개 서비스로 배포하려면 별도 인증·비용 통제·영구 저장·HTTPS 구성을 먼저 설계해야 한다.

공식 요청 형식 확인: [OpenAI 구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [Google Gemini generateContent API](https://ai.google.dev/api/generate-content). 기존 모델 선택은 이번 작업에서 변경하지 않았다.
