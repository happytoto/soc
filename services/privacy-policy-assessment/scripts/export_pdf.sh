#!/usr/bin/env bash
# 산출물 md → 고객 전달용 PDF. pandoc으로 HTML을 만들고 Chromium headless로 PDF 인쇄한다(LaTeX 불필요).
# 사용: scripts/export_pdf.sh <문서.md> [출력.pdf]
# 전달본 파일명 규칙: <기업명>_<문서명>_v<버전>_<YYYYMMDD>.pdf
set -euo pipefail
SRC="${1:?md 파일 필요}"; PDF="${2:-${SRC%.md}.pdf}"
TMP_HTML="$(mktemp --suffix=.html)"
CSS='body{font-family:"Noto Sans KR","Malgun Gothic",sans-serif;font-size:11pt;line-height:1.55;max-width:900px;margin:24px auto;color:#121a2b}
table{border-collapse:collapse;width:100%;font-size:9.5pt;margin:8px 0}th,td{border:1px solid #c9d0db;padding:5px 7px;vertical-align:top}th{background:#eef2f7}
h1{font-size:20pt;border-bottom:2px solid #16294f;padding-bottom:6px}h2{font-size:14pt;color:#16294f;margin-top:22px}h3{font-size:12pt}
blockquote{border-left:4px solid #e4552c;margin:0;padding:6px 12px;background:#fff6f1}code{font-size:9pt}@page{margin:18mm 14mm}'
pandoc "$SRC" -f gfm -t html5 --standalone --metadata title="$(basename "${SRC%.md}")" -H <(printf '<style>%s</style>' "$CSS") -o "$TMP_HTML"
CHROME="${CHROME_BIN:-}"
for c in /opt/pw-browsers/chromium /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
  [ -z "$CHROME" ] && [ -x "$c" ] && CHROME="$c"
done
[ -n "$CHROME" ] || { echo "Chromium/Chrome 실행 파일을 찾지 못함. CHROME_BIN=경로 로 지정" >&2; exit 1; }
"$CHROME" --headless --no-sandbox --disable-gpu --print-to-pdf="$PDF" --no-pdf-header-footer "file://$TMP_HTML" >/dev/null 2>&1
rm -f "$TMP_HTML"
echo "생성: $PDF"
