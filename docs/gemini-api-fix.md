# 개인 Gemini API 키 호출 수정

## 원인과 수정

- 기존 웹·Android 요청의 `generationConfig.responseFormat.text.mimeType`은 `application/json`이었다.
- 이 필드는 MIME 문자열이 아닌 protobuf 열거형이므로 `APPLICATION_JSON`이어야 한다. HTTP 헤더의 `Content-Type: application/json`은 그대로 유지한다.
- Google의 실제 엔드포인트에 **키 없이** 전송해 기존 값이 HTTP 400 / INVALID_ARGUMENT를 유발함을 재현했다. 수정 값은 키 없는 요청의 HTTP 403 / PERMISSION_DENIED까지 진행한다.
- 두 클라이언트 모두 수정했다. 모델은 기존 `gemini-3.8-flash`를 유지하며 임의의 다른 모델로 전환하거나 유료 요청을 자동 재시도하지 않는다.
- 오류 본문은 분류에만 사용한다. 원문·헤더·키·입력 데이터는 화면이나 로그에 출력하지 않는다. 키 유효성, 노출 키 차단, API 비활성화, 앱/웹 사용 제한, 계정 조건, 요청 형식, 사용량 제한을 고정 문구로 구분한다.
- 단어 조합 화면 상단의 중복 홈 버튼은 웹·Android 모두 삭제했다. 하단 홈 탭은 유지한다.

## 재검증

```powershell
node --test tests/*.test.js
node scripts/check-gemini-protocol.mjs
npm run build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Install
& "$env:LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" shell am instrument -w com.ideaassist.app/.AppCoreInstrumentation
```

`check-gemini-protocol.mjs`는 환경변수나 사용자 키를 읽지 않는다. 공개 예시 요청의 역직렬화 오류 및 인증 단계 도달만 검증하며 **생성 성공 검증이 아니다**. 자동 테스트도 실제 개인 키로 모델을 호출하지 않는다.

## 실제 키로 최종 확인하는 방법

1. 새 APK 실행 또는 웹 새로고침 후 **모델 설정 → 클라우드 AI → Google Gemini · AI Studio**를 선택한다.
2. 본인의 키를 앱/웹 비밀번호 입력란에 직접 입력하고 전송·비용 동의 후 설정을 저장한다. 채팅이나 소스 파일에 키를 넣지 않는다.
3. 분야 선택 → 단어 조합 → 생성 → 발전 → 구체화를 순서대로 실행한다. 이때 Google로 입력이 전송되고 API 이용 조건에 따라 비용이 발생할 수 있다.
4. API 키는 메모리 전용이므로 앱 프로세스 종료/재설치 또는 웹 새로고침 후 다시 입력해야 한다. 제공업체와 비용 동의는 별도 저장된다.
5. 실패하면 새로 표시되는 오류 분류를 확인한다. 키 사용 제한이 웹 전용인 경우 Android에서, Android 전용인 경우 웹에서 허용되지 않을 수 있다. 제한을 무작정 해제하지 말고 실제 실행 환경에 맞는 설정을 확인한다.

## 검증의 한계

정상 개인 키의 프로젝트 권한, 지역·이용 조건, 잔여 할당량과 실제 모델 생성 품질은 키 없이 확인할 수 없다. 본 수정은 재현된 앱 요청 오류를 해결하지만, 모든 계정에서 생성 성공을 보장한다는 의미는 아니다. OpenAI 개인 키 경로는 유지하며 Gemini 키와 서로 호환되지 않는다.

## 이번 실행 결과 (2026-10-19)

- 자동 테스트 49개 통과, 웹 프로덕션 빌드 성공. 기존 WebLLM 번들 크기와 lucide의 지시문 경고는 남아 있다.
- Google 실제 엔드포인트: 기존 잘못된 값의 400 재현, 수정된 생성·발전·구체화 요청 3종은 키 없는 인증 거절 단계까지 진행.
- Android APK 빌드·에뮬레이터 설치 성공. `AppCoreInstrumentation`: **10개 그룹 통과**. 요청 형식, 오류 분류, 키 원문 비노출, 조합 화면에 홈 버튼 하나만 존재함을 포함한다.
- 에뮬레이터와 웹 조합 화면에서 상단 홈 삭제 및 하단 홈 유지 확인.
- 새 APK의 압축 해제된 21개 항목 대상 비밀 키 패턴 검사: 발견 없음. 패턴 검사이며 완전한 보안 보증은 아니다.
- APK SHA-256: `F198DFCED6B944B46540A5A863CA103E869781D543EF1747DD572E2D1B386914`.
- 정상 개인 키로 실제 생성·발전·구체화 성공 여부는 아직 미검증. 사용자 직접 키 입력 후 확인 필요.
- 변경 내용은 로컬 웹 및 새 APK에 반영했다. 이번 요청에서 Git 원격 푸시는 수행하지 않았다.

## 근거

- [Google REST 명세: TextResponseFormat와 MimeType](https://ai.google.dev/api/generate-content#TextResponseFormat)
- [Google Gemini 문제 해결](https://ai.google.dev/gemini-api/docs/troubleshooting)
