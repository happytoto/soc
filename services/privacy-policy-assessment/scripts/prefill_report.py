#!/usr/bin/env python3
"""체크리스트 ID 행을 평가분석 보고서(03) 표에 사전 생성한다.

사용: python3 scripts/prefill_report.py <checklists/policy-eval-checklist.md> <output/03_policy-evaluation-report.md>

- 체크리스트 A(적정성)·B(가독성)·C(접근성)·E(최신성) 섹션의 ID·항목·근거를 읽는다.
- 보고서의 "## 2."(A) · "## 3."(B) · "## 4."(C) · "## 6."(E) 표에서 헤더·구분선 아래의 기존 행(예시 행 포함)을 지우고
  체크리스트 순서대로 한 행씩 넣는다. 판정·인용·권고 칸은 비워 둔다.
- 이미 판정값(있음/없음/불명확/해당없음)이 적힌 행이 하나라도 있으면 그 표는 건드리지 않는다(재실행 안전).
- D(정합성)는 불일치 목록이므로 생성하지 않는다. 네트워크 요청 없음.
"""
import re
import sys

JUDGE = ("있음", "없음", "불명확", "해당없음")
# 보고서 섹션 번호 → (체크리스트 섹션 문자, 행 생성 함수)
PLAN = {
    "2": ("A", lambda r: f"| {r['id']} | {r['item']} | | | {r['basis']} | |"),
    "3": ("B", lambda r: f"| {r['id']} | {r['item']} | | | |"),
    "4": ("C", lambda r: f"| {r['id']} | {r['item']} | | | |"),
    "6": ("E", lambda r: f"| {r['id']} | {r['item']} | | |"),
}


def parse_checklist(path):
    rows = {k: [] for k in "ABCDE"}
    for line in open(path, encoding="utf-8"):
        m = re.match(r"^\|\s*([A-E])-(\d{2})\s*\|(.*)\|\s*$", line.rstrip("\n"))
        if not m:
            continue
        sec = m.group(1)
        cells = [c.strip() for c in m.group(3).split("|")]
        # A: 항목|근거|확인방법|판정|비고 · B/C: 항목|확인방법|판정|비고 · E: 항목|근거|판정|비고
        rows[sec].append({"id": f"{sec}-{m.group(2)}", "item": cells[0], "basis": cells[1] if sec in "AE" else ""})
    return rows


def main(argv):
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 1
    rows = parse_checklist(argv[1])
    path = argv[2]
    lines = open(path, encoding="utf-8").read().split("\n")
    out, i, filled, skipped = [], 0, [], []
    while i < len(lines):
        line = lines[i]
        m = re.match(r"^## (\d)\.", line)
        if not m or m.group(1) not in PLAN:
            out.append(line); i += 1; continue
        sec, make = PLAN[m.group(1)]
        out.append(line); i += 1
        # 헤더·구분선까지 복사
        while i < len(lines) and not (lines[i].startswith("|") and i + 1 < len(lines) and re.match(r"^\|\s*-", lines[i + 1])):
            out.append(lines[i]); i += 1
        if i >= len(lines):
            break
        out.append(lines[i]); out.append(lines[i + 1]); i += 2
        # 기존 데이터 행 수집
        old = []
        while i < len(lines) and lines[i].startswith("|"):
            old.append(lines[i]); i += 1
        judged = any(any(c.strip() in JUDGE for c in l.split("|")) for l in old)
        if judged or not rows[sec]:
            out.extend(old); skipped.append(f"{sec}({'판정값 있음' if judged else '체크리스트 행 없음'})")
            continue
        out.extend(make(r) for r in rows[sec]); filled.append(f"{sec}:{len(rows[sec])}")
    open(path, "w", encoding="utf-8").write("\n".join(out))
    print("생성: " + ", ".join(filled) if filled else "생성 없음", ("· 건너뜀: " + ", ".join(skipped)) if skipped else "")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
