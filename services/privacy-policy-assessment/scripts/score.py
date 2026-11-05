#!/usr/bin/env python3
"""처리방침 평가 체크리스트 점수 자동 산정.

사용: python3 scripts/score.py <작성 완료한 03_policy-evaluation-report.md 또는 policy-eval-checklist.md>

규칙(checklists/policy-eval-checklist.md '점수 환산'):
- A(적정성) 50점: 해당 항목 중 '있음' 비율 × 50  ('해당없음'은 분모에서 제외)
- B(가독성) 15점, C(접근성) 15점: 각 '있음' 비율 × 15
- D(정합성) 20점: 불일치 0건 20, 1~2건 10, 3건 이상 0
표의 1열이 A-xx/B-xx/C-xx 형식인 행만 읽는다. 판정 열은 '있음/없음/불명확/해당없음' 중 첫 번째로 나오는 값을 쓴다.
D는 '## 5. 정합성' 절의 번호 행(| 1 | ...) 수를 불일치 건수로 센다.
"""
import re
import sys
from collections import defaultdict

JUDGE = ("있음", "없음", "불명확", "해당없음")


def main(path: str) -> int:
    text = open(path, encoding="utf-8").read()
    counts = defaultdict(lambda: {"있음": 0, "없음": 0, "불명확": 0, "해당없음": 0, "미판정": 0})
    for line in text.splitlines():
        m = re.match(r"^\|\s*([ABCDE])-(\d{2})\s*\|", line)
        if not m:
            continue
        sec = m.group(1)
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        judge = next((j for c in cells[2:] for j in JUDGE if c == j), None)
        if sec == "D":
            continue
        counts[sec][judge or "미판정"] += 1

    # D: 정합성 불일치 건수 = '## 5. 정합성' 절의 번호 행
    mismatch = 0
    sec5 = re.search(r"## 5\. 정합성(.*?)(\n## |\Z)", text, re.S)
    if sec5:
        mismatch = len([l for l in sec5.group(1).splitlines() if re.match(r"^\|\s*\d+\s*\|", l)])

    def ratio(sec):
        c = counts[sec]
        denom = c["있음"] + c["없음"] + c["불명확"] + c["미판정"]
        return (c["있음"] / denom) if denom else 0.0

    a = round(ratio("A") * 50, 1)
    b = round(ratio("B") * 15, 1)
    c = round(ratio("C") * 15, 1)
    d = 20 if mismatch == 0 else (10 if mismatch <= 2 else 0)
    total = round(a + b + c + d, 1)

    print("| 영역 | 있음 | 없음 | 불명확 | 해당없음 | 미판정 | 점수 |")
    print("|---|---|---|---|---|---|---|")
    for sec, pts in (("A", a), ("B", b), ("C", c)):
        k = counts[sec]
        print(f"| {sec} | {k['있음']} | {k['없음']} | {k['불명확']} | {k['해당없음']} | {k['미판정']} | {pts} |")
    print(f"| D | 불일치 {mismatch}건 | | | | | {d} |")
    print(f"| **합계** | | | | | | **{total} / 100** |")
    empty = [s for s in ("A", "B", "C") if sum(counts[s].values()) == 0]
    if empty:
        print(f"\n경고: {'·'.join(empty)} 섹션에 판정 행이 없음(0건 → 0점). 체크리스트 ID 행을 채운 뒤 다시 산정.")
    unjudged = sum(counts[s]["미판정"] for s in ("A", "B", "C"))
    if unjudged or empty:
        print(f"\n경고: 미판정 {unjudged}건. 모두 판정하기 전에는 전달 불가.")
        return 2
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(sys.argv[1]))
