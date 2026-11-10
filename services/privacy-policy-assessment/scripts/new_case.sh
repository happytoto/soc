#!/usr/bin/env bash
# 케이스 폴더 생성: 템플릿을 복사하고 접수 양식을 만든다.
# 사용: scripts/new_case.sh "<기업명>" <도메인> [--mode new|upgrade]
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "사용법: $0 \"<기업명>\" <도메인> [--mode new|upgrade]" >&2
  exit 1
fi

COMPANY="$1"; DOMAIN="$2"; MODE="new"
if [ "${3:-}" = "--mode" ] && [ -n "${4:-}" ]; then MODE="$4"; fi

BASE="$(cd "$(dirname "$0")/.." && pwd)"
SAFE_NAME="$(echo "$COMPANY" | tr -cd '[:alnum:]가-힣_-' )"
CASE_DIR="$BASE/cases/$(date +%F)_${SAFE_NAME}"

if [ -e "$CASE_DIR" ]; then
  echo "이미 존재: $CASE_DIR" >&2
  exit 1
fi

mkdir -p "$CASE_DIR"/{input,osint/captures,review,delivery,output}
# 표준 표지 블록을 각 산출물 템플릿 앞에 붙여 복사 (_cover-block.md 자체는 제외)
for t in "$BASE"/templates/0*.md; do
  { cat "$BASE/templates/_cover-block.md" "$t"; } | sed -e "s/{{기업명}}/$COMPANY/g" -e "s/{{도메인}}/$DOMAIN/g" -e "s/{{YYYY-MM-DD}}/$(date +%F)/g" > "$CASE_DIR/output/$(basename "$t")"
done
cp "$BASE/review/cross-check-prompt.md" "$CASE_DIR/review/" 2>/dev/null || true
# 평가분석 보고서(03)에 체크리스트 ID 행 사전 생성 (판정 칸은 비움)
python3 "$BASE/scripts/prefill_report.py" "$BASE/checklists/policy-eval-checklist.md" "$CASE_DIR/output/03_policy-evaluation-report.md" || echo "경고: 보고서 사전 생성 실패 (수동으로 체크리스트 ID 행 복사)" >&2

cat > "$CASE_DIR/00_intake.md" <<EOF
# 접수 (Intake)

| 항목 | 내용 |
|---|---|
| 기업명 | $COMPANY |
| 도메인 | $DOMAIN |
| 모드 | $MODE (new=신규 작성, upgrade=기존 문서 고도화·현행화) |
| 접수일 | $(date +%F) |
| 서비스 목록 (웹·앱·오프라인) | |
| 보유 인증 (ISMS/ISMS-P/간편) | |
| 고객 담당자 | |
| 계약 범위 (policy / flow / full) | |
| 납기 | |
| 법령 기준일 (law-watch) | |
| 담당 컨설턴트 / 검증자 | |
| 이해충돌 확인 (심사 참여 금지 대상) | |

## 처리방침 평가 대상 해당 가능성 (사전 진단)
근거: 「개인정보 처리방침 평가에 관한 고시」 제4조제1항 (references/law/L-04.md, 검증완료). 보호위원회가 6개 사항을 "종합적으로 고려"해 심의·의결하므로 한 개라도 "예"이면 평가 대상 가능성 있음으로 표시한다. 판정이 아니라 영업·우선순위 참고용이다.

| # | 질문 (고시 §4①) | 예/아니오/모름 | 근거 자료 |
|---|---|---|---|
| 1 | 전년도 매출액 1,500억원 이상이면서 전년도 말 기준 직전 3개월 일평균 정보주체 수 100만명 이상인가 | | |
| 2 | 전년도 말 기준 직전 3개월 민감정보 또는 고유식별정보 정보주체 수가 일평균 5만명 이상인가 (업무상 임직원 정보 제외) | | |
| 3 | 처리방침에서 동의 없이 처리하는 항목·법적 근거(법 §22③)를 동의 기반 항목과 구분하지 않고 있는가 | | |
| 4 | 완전히 자동화된 시스템(AI 포함, 법 §37의2) 또는 새로운 기술로 개인정보를 처리해 침해 우려가 있는가 | | |
| 5 | 최근 3년간 유출등 2회 이상(법 §34), 과징금(고시 표기 법 §62의2 — 현행 법 과징금 조문은 §64의2, L-14) 또는 과태료(법 §75)를 받은 적이 있는가 | | |
| 6 | 19세 미만 아동·청소년이 주된 이용자인 정보통신서비스를 운영하는가 | | |

- 결과: {{해당 가능성 있음/낮음}} — "예" 문항 번호: 
- 주의: 고시 제2024-3호(2024-02-20) 기준. 후속 개정 여부는 law-watch L-04에서 확인.

## OSINT 범위 통지
- 통지일:
- 통지 대상 도메인: $DOMAIN
- 방식: 비침투·수동(passive). 로그인·인증·폼 제출·스캔 없음.
EOF

cat > "$CASE_DIR/access-log.md" <<EOF
# 열람 기록
| 일시 | 이름 | 목적 |
|---|---|---|
| $(date '+%F %H:%M') | $(whoami) | 케이스 생성 |
EOF

cat > "$CASE_DIR/interview-questions.md" <<EOF
# 인터뷰 질문 (공개정보로 확인 불가 항목)
| 질문 | 관련 기준 | 필요한 증적 |
|---|---|---|
EOF

cat > "$CASE_DIR/review/cross-check.md" <<EOF
# 교차검증 기록 (G4)
검증자: · 일시:

| # | 결함 | 반박 | 결과 (유지/강등/삭제) | 사유 |
|---|---|---|---|---|
EOF

cat > "$CASE_DIR/delivery/approval.md" <<EOF
# 전달 승인
| 항목 | 값 |
|---|---|
| QA 게이트 통과 | |
| 케이스 점수 | /100 |
| 승인자 | |
| 승인 일시 | |
| 전달 채널 | |
| 전달 파일 | |
EOF

echo "케이스 생성: $CASE_DIR"
echo "다음: scripts/osint_collect.sh $DOMAIN \"$CASE_DIR\""
