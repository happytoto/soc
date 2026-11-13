#!/usr/bin/env bash
# 개인정보처리방침 URL 자동 탐색 + 본문 저장 (passive, 최대 GET 3회: 메인 1회·robots.txt 1회·방침 1회)
# 사용: scripts/fetch_policy.sh <도메인 또는 메인URL 또는 방침URL> <케이스폴더>
# 산출: <케이스>/input/policy_<YYYY-MM-DD>.md (원문 Markdown + 출처 블록), 같은 이름 .html (원본), osint/policy-link-candidates.txt
# 규칙: 요청 간격 1.5초, 리다이렉트 5회, 로그인·폼 제출 없음. robots.txt 가 금지한 경로면 받지 않고 로그만 남긴다.
#       osint_collect.sh 가 이미 받아 둔 osint/index.html·robots.txt 가 있으면 재요청하지 않는다.
set -euo pipefail

TARGET="${1:?도메인 또는 URL 필요}"; CASE_DIR="${2:?케이스 폴더 필요}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OSINT="$CASE_DIR/osint"; INPUT="$CASE_DIR/input"; mkdir -p "$OSINT" "$INPUT"
LOG="$OSINT/00_collection-log.md"
UA="RocketSec-PassiveCheck/0.1 (+contact@aplusnet.net)"
SLEEP="${FETCH_SLEEP:-1.5}"
TODAY="$(date +%F)"

ts(){ date '+%F %H:%M:%S'; }
log(){ echo "| $(ts) | $1 | $2 | $3 |" >> "$LOG"; }
fetch(){ sleep "$SLEEP"; curl -sS -L --max-redirs 5 --max-time 20 -A "$UA" -o "$2" -w '%{http_code}' "$1" 2>/dev/null || echo "ERR"; }

# 1. 입력 해석: 방침 URL 직접 지정 / 메인 URL / 도메인
if [[ "$TARGET" =~ ^https?:// ]]; then BASE="$TARGET"; else BASE="https://$TARGET/"; fi
ORIGIN="$(echo "$BASE" | sed -E 's#^(https?://[^/]+).*#\1#')"
[ -f "$LOG" ] || printf '# 공개정보 수집 로그 — %s\n방식: passive only (로그인·인증·폼 제출·스캔 없음). 요청 간격 %s초.\n\n| 시각 | 대상 | 방법 | 결과 |\n|---|---|---|---|\n' "$ORIGIN" "$SLEEP" > "$LOG"
POLICY_URL=""
if [[ "$BASE" =~ (privacy|policy|개인정보) ]]; then POLICY_URL="$BASE"; fi

# 2. 메인 페이지에서 후보 추출 (방침 URL 미지정 시)
if [ -z "$POLICY_URL" ]; then
  INDEX="$OSINT/index.html"
  if [ -s "$INDEX" ]; then
    log "$BASE" "메인 재사용" "osint/index.html (재요청 없음)"
  else
    code=$(fetch "$BASE" "$INDEX"); log "$BASE" "GET 1회 (메인)" "HTTP $code"
    if [ "$code" = "429" ] || [ "$code" = "403" ]; then log "$BASE" "중단" "차단 응답 $code — 수동 확인 필요"; echo "차단 응답 $code, 중단" >&2; exit 5; fi
  fi
  if python3 "$SCRIPT_DIR/find_policy_links.py" "$BASE" "$INDEX" > "$OSINT/policy-link-candidates.txt" 2>/dev/null; then
    POLICY_URL="$(head -1 "$OSINT/policy-link-candidates.txt" | cut -f2)"
    log "index.html" "처리방침 링크 후보 추출" "$(wc -l < "$OSINT/policy-link-candidates.txt")건, 1순위 $POLICY_URL"
  else
    log "index.html" "처리방침 링크 후보 추출" "0건 — 수동으로 URL 지정 필요"
    echo "후보 없음. 방침 URL을 직접 지정: $0 <방침URL> <케이스폴더>" >&2; exit 4
  fi
fi

# 3. robots.txt 확인 (금지 경로면 받지 않음)
ROBOTS="$OSINT/robots.txt"
if [ ! -s "$ROBOTS" ]; then code=$(fetch "$ORIGIN/robots.txt" "$ROBOTS"); log "$ORIGIN/robots.txt" "GET" "HTTP $code"; fi
POLICY_PATH="${POLICY_URL#"$ORIGIN"}"; [ "$POLICY_PATH" = "$POLICY_URL" ] && POLICY_PATH="/"
if [ -s "$ROBOTS" ] && python3 - "$ROBOTS" "$POLICY_PATH" <<'PY'
import sys,re
rules=open(sys.argv[1],encoding='utf-8',errors='replace').read().splitlines(); path=sys.argv[2]
ua=None; dis=[]
for l in rules:
    l=l.split('#')[0].strip()
    m=re.match(r'(?i)user-agent:\s*(.+)',l)
    if m: ua=m.group(1).strip(); continue
    m=re.match(r'(?i)disallow:\s*(.*)',l)
    if m and ua=='*' and m.group(1).strip(): dis.append(m.group(1).strip())
sys.exit(0 if any(path.startswith(d.rstrip('*')) for d in dis) else 1)
PY
then
  log "$POLICY_URL" "robots.txt 확인" "Disallow 경로 — 수집하지 않음(수동 열람)"
  echo "robots.txt 금지 경로: $POLICY_URL — 받지 않음" >&2; exit 6
fi

# 4. 방침 페이지 1회 GET → 원본 저장 → Markdown 변환
STEM="policy_$TODAY"; n=1
while [ -e "$INPUT/$STEM.md" ] || [ -e "$INPUT/$STEM.html" ]; do n=$((n+1)); STEM="policy_${TODAY}_$n"; done   # 같은 날 2건째(이전 버전 등)는 _2, _3
RAW="$INPUT/$STEM.html"; MD="$INPUT/$STEM.md"
code=$(fetch "$POLICY_URL" "$RAW"); log "$POLICY_URL" "GET 1회 (처리방침)" "HTTP $code → input/$STEM.html"
if [ "$code" != "200" ] || [ ! -s "$RAW" ]; then echo "방침 페이지 수신 실패 (HTTP $code)" >&2; exit 7; fi
SHA="$(sha256sum "$RAW" | cut -c1-16)"
{
  echo "# 개인정보처리방침 원문 (자동 저장)"
  echo
  echo "| 항목 | 값 |"; echo "|---|---|"
  echo "| 출처 URL | $POLICY_URL |"
  echo "| 확인일시 | $(ts) |"
  echo "| HTTP | $code |"
  echo "| 원본 파일 | input/$STEM.html (SHA-256 앞 16자리: $SHA) |"
  echo "| 후보 목록 | osint/policy-link-candidates.txt |"
  echo "| 주의 | 자동 변환본. 표·들여쓰기·이전 버전 링크는 원본 HTML 또는 브라우저 화면으로 대조한다. |"
  echo; echo "---"; echo
  if command -v pandoc >/dev/null; then
    pandoc -f html -t gfm --wrap=none "$RAW" 2>/dev/null || sed -e 's/<[^>]*>//g' "$RAW"
  else
    sed -e 's/<[^>]*>//g' "$RAW"
  fi
} > "$MD"
log "$POLICY_URL" "Markdown 변환" "input/$STEM.md ($(wc -l < "$MD")줄)"
echo "저장: $MD"
# 03 보고서 "대상"·"비교 버전" 행 자동 기입 (보고서가 있을 때만, 이미 채운 칸은 유지)
if [ -f "$CASE_DIR/output/03_policy-evaluation-report.md" ]; then python3 "$SCRIPT_DIR/fill_target_row.py" "$CASE_DIR" || true; fi
echo "다음: 본문을 눈으로 확인하고 이전 버전 링크가 있으면 같은 방식으로 저장 (scripts/fetch_policy.sh <이전버전URL> \"$CASE_DIR\")"
