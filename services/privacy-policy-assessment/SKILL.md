---
name: privacy-policy-assessment
description: 기업명·도메인을 입력받아 개인정보처리방침 평가, 개인정보 흐름표·흐름도, ISMS-P 모의심사까지 6종 문서를 생성하는 로켓보안 컨설팅 워크플로. "처리방침 평가해줘", "개인정보 흐름도 만들어줘", "모의심사 해줘", "privacy policy assessment" 요청에 사용. 공개정보만(passive) 수집하며 능동 스캔은 하지 않는다.
argument-hint: "<기업명> <도메인> [--mode new|upgrade] [--scope policy|flow|full]"
metadata:
  origin: rocketsec
  version: 0.1.0
---

# 개인정보처리방침 평가 스킬

이 스킬은 `MANUAL.md`를 실행하는 래퍼다. 매뉴얼이 원본이고 스킬은 순서만 강제한다.

## 실행 순서

1. **읽기**: `README.md` → `MANUAL.md` → `checklists/law-watch.md`(법령 기준일 확인). law-watch에 `[검증필요]`가 남아 있는 조문을 보고서에 쓸 때는 반드시 "확인 필요" 표시를 붙인다.
2. **케이스 생성**: `scripts/new_case.sh "<기업명>" <도메인>` 실행. 생성된 폴더 경로를 기억한다.
3. **Phase 1 OSINT**: `scripts/osint_collect.sh <도메인> <케이스폴더>` 실행 후, 브라우저/웹 읽기 도구로 비로그인 공개 화면만 확인한다. 금지 행위 목록은 `security/access-control.md` §3. 확인한 모든 URL을 `osint/00_collection-log.md`에 적는다.
4. **Phase 2 처리방침 평가**: `checklists/policy-eval-checklist.md` 항목을 전부 돌며 `templates/03_policy-evaluation-report.md`를 채운다. 원문 인용 없이 "없음" 판정 금지. 이어서 `templates/02_privacy-policy.md`로 개정안 작성.
5. **Phase 3 흐름 분석**: `checklists/flow-analysis-checklist.md`로 경로를 전수조사해 `templates/04_data-flow-table.md`, `templates/05_data-flow-diagram.md` 작성. 공개정보로 모르는 것은 인터뷰 질문으로 분리.
6. **Phase 4 모의심사**: `templates/06_mock-audit-report.md` 작성. 한줄결함 형식 준수.
7. **교차검증(G4)**: 새 세션 또는 별도 프로필(102 역할)로 `review/cross-check.md`를 작성시킨다. 프롬프트: "다음 결함 목록을 심사팀장 입장에서 하나씩 반박하라. 근거가 약한 것은 강등 사유를 써라." 반박에 진 항목은 강등·삭제.
8. **Phase 5 통합**: `templates/01_analysis-report.md` 작성.
9. **QA 게이트**: `quality/qa-gate.md` 전 항목 체크, `quality/scoring.md`로 점수 산정. 70점 미만이면 전달 불가, 부족 항목을 `improvement/BACKLOG.md`에 추가.
10. **승인 요청**: 사용자에게 점수·핵심 위험 5개·전달 파일 목록을 표로 보고하고 승인을 기다린다. 승인 전 발송 금지.
11. **기록**: `improvement/DAILY_LOG.md`에 날짜·케이스·점수·발견한 개선점을 추가.

## 출력 형식 (사용자 보고)

| 항목 | 값 |
|---|---|
| 케이스 | 폴더 경로 |
| 모드 | 신규 / 고도화 |
| 완성도 점수 | NN / 100 |
| P1 결함 수 | n |
| 확인 필요 항목 수 | n (인터뷰 질문으로 전환) |
| 전달 파일 | 6종 목록 |
| 다음 조치 | 승인 요청 / 보완 필요 항목 |

## 하지 않는 것

- 로그인, 인증번호 요청, 계정 생성, 결제, 폼 제출, 취약점 스캐너 실행, 초당 다수 요청
- 고객 자료를 케이스 폴더 밖으로 복사
- 법 조문 번호 추측. 확인 못 하면 "확인 필요"
- 승인 없는 전달·발송
