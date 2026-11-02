# 개인정보처리방침 평가 서비스 (Privacy Policy Assessment)

로켓보안(에이플러스넷)의 유료 개인정보 컨설팅 서비스를 **반복 실행 가능한 매뉴얼 + 템플릿 + 일일 개선 루프**로 정의한다.
한 번에 완성하지 않는다. 매일 한 가지씩 고치고, 점수를 기록하고, 다음 날 더 높인다.

| 항목 | 내용 |
|---|---|
| 서비스 버전 | v0.1.0 (2026-11-02 최초 작성) |
| 입력 | 기업명, 서비스 도메인 (선택: 기존 처리방침·흐름표·흐름도) |
| 출력 | 6종 문서: 분석보고서 · 개인정보처리방침 · 처리방침 평가분석 보고서 · 흐름표 초안+평가 · 흐름도 초안+평가 · 모의심사 보고서 |
| 수행 역할 | 개인정보영향평가 전문가 · ISMS-P 인증심사원 · 심사팀장 · 변호사(법령 검토) · 컨설턴트(고객 전달) |
| 완성도 점수 | `quality/scoring.md` 기준 0~100점. 현재 목표: 매일 +1점 이상 |
| 실행 진입점 | `SKILL.md` (Claude Code 스킬) 또는 `MANUAL.md` 수동 수행 |

## 설계 원칙 (Hermes101/102 운영 원칙 적용)

1. **Workflow first, autonomous later** — 검증 가능한 단계별 워크플로로 먼저 만들고, 자동화는 단계별로 붙인다.
2. **원장 중심** — 모든 수집·판단·근거·승인·전달 기록을 케이스 폴더와 원장(Sheets)에 남긴다.
3. **승인 게이트** — 고객 전달, 외부 발송, OSINT 능동 스캔, 파기는 사람 승인 없이 실행하지 않는다.
4. **근거 없는 지적 금지** — 모든 결함·권고에 법 조문 또는 인증기준 번호, 확인한 화면·문서(URL/캡처)를 붙인다. 모르면 "확인 필요"로 적는다.
5. **적대적 교차검증** — 작성자(101 역할)와 검증자(102 역할)를 분리한다. 검증자는 결함을 반박하려 시도하고, 살아남은 것만 보고서에 남는다.
6. **실패를 자산화** — 고객 피드백·오탐·누락은 `improvement/BACKLOG.md`와 평가셋에 기록해 같은 실수를 반복하지 않는다.
7. **루프 제한** — 평가자 루프는 최대 2회. 비용·시간·품질 기준으로 중단한다.

## 폴더 구조

```
services/privacy-policy-assessment/
├── README.md                 이 문서
├── MANUAL.md                 운영 매뉴얼 (단계별 절차, 게이트, 산출물)
├── SKILL.md                  Claude Code 스킬 (매뉴얼 실행 래퍼)
├── checklists/
│   ├── policy-eval-checklist.md    처리방침 평가 항목표 (법 §30·§30의2·시행령 §31)
│   ├── flow-analysis-checklist.md  수집·처리 경로 전수조사 체크리스트
│   └── law-watch.md                법령·고시·지침 개정 추적표 (확인일·근거)
├── templates/                6종 산출물 템플릿
│   ├── 01_analysis-report.md
│   ├── 02_privacy-policy.md
│   ├── 03_policy-evaluation-report.md
│   ├── 04_data-flow-table.md
│   ├── 05_data-flow-diagram.md
│   └── 06_mock-audit-report.md
├── quality/
│   ├── qa-gate.md            고객 전달 전 검증 게이트 (팩트체크·최신성·정확성·품질)
│   └── scoring.md            완성도 점수표
├── improvement/
│   ├── daily-routine.md      매일 실행하는 개선 루틴
│   ├── BACKLOG.md            개선 백로그 (우선순위)
│   └── DAILY_LOG.md          일일 개선 기록 (날짜·변경·점수)
├── security/
│   └── access-control.md     열람 권한·보관·파기·OSINT 안전 수칙
├── scripts/
│   ├── new_case.sh           케이스 폴더 생성 (템플릿 복사)
│   └── osint_collect.sh      수동(passive) 공개정보 수집 래퍼
└── cases/                    고객별 작업 폴더 (git 제외, 암호화 보관)
```

## 빠른 시작

```bash
# 1. 케이스 생성
services/privacy-policy-assessment/scripts/new_case.sh "㈜예시" example.co.kr

# 2. 공개정보 수집 (passive only)
services/privacy-policy-assessment/scripts/osint_collect.sh example.co.kr cases/2026-11-02_예시

# 3. MANUAL.md Phase 2~6 수행 → templates 채우기
# 4. quality/qa-gate.md 통과 → 승인 후 고객 전달
# 5. improvement/DAILY_LOG.md 기록
```

## 현재 상태와 한계 (정직하게)

- 법령 조문 번호와 시행일은 작성 시점 기억 기반이며 `checklists/law-watch.md`에 **[검증필요]** 표시가 남아 있다. 첫 일일 루틴에서 law.go.kr·개인정보위 원문으로 확인한다.
- OSINT 스크립트는 spiderfoot 설치 여부를 확인해 없으면 기본 도구(dig, curl, whois, crt.sh)만 사용한다.
- 흐름도는 Mermaid 텍스트로 작성한다. 고객 제출용 이미지 변환은 수동 단계다.
