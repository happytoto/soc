#!/usr/bin/env python3
"""HTML에서 개인정보처리방침 링크 후보를 찾아 점수순으로 출력한다.

사용: python3 scripts/find_policy_links.py <페이지URL> <저장된 HTML 파일>
출력: 탭 구분 "점수<TAB>절대URL<TAB>링크 텍스트" (점수 내림차순, 중복 URL 제거)

점수 규칙(합산):
  +5 링크 텍스트에 '개인정보처리방침' 또는 '개인정보 처리방침'
  +3 링크 텍스트에 '개인정보' 또는 'privacy'(대소문자 무시)
  +3 href에 privacy / personal / policy 포함
  +2 <footer> 또는 class·id에 footer/foot가 있는 요소 안의 링크
  -4 링크 텍스트에 '이용약관'·'terms'만 있고 개인정보 언급이 없음
  -2 텍스트·href에 '이전'·'old'·'archive'·'previous'·'history' (이전 버전은 2순위로)
  -2 href가 javascript:, mailto:, # 뿐인 경우(후보에서 제외)
네트워크 요청을 하지 않는다. 입력 파일만 읽는다.
"""
import re
import sys
from html.parser import HTMLParser
from urllib.parse import urljoin, urldefrag


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []          # (href, text, in_footer)
        self._footer_depth = 0
        self._stack = []         # True if element counted as footer
        self._cur = None         # [href, text parts, in_footer]
        self._skip = 0           # inside script/style

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("script", "style", "noscript"):
            self._skip += 1
        is_footer = tag == "footer" or bool(re.search(r"\bfoot", f"{a.get('class','')} {a.get('id','')}", re.I))
        self._stack.append(is_footer)
        if is_footer:
            self._footer_depth += 1
        if tag == "a" and a.get("href"):
            self._cur = [a["href"].strip(), [], self._footer_depth > 0, (a.get("title") or "") + " " + (a.get("aria-label") or "")]

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1
        if self._stack:
            if self._stack.pop():
                self._footer_depth -= 1
        if tag == "a" and self._cur:
            href, parts, in_footer, extra = self._cur
            self.links.append((href, " ".join(" ".join(parts).split()), in_footer, extra))
            self._cur = None

    def handle_data(self, data):
        if self._cur and not self._skip:
            self._cur[1].append(data)


def score(href, text, in_footer, extra):
    h, t = href.lower(), (text + " " + extra).lower()
    if h.startswith(("javascript:", "mailto:", "tel:")) or h.strip("#") == "":
        return None
    s = 0
    if re.search(r"개인정보\s*처리\s*방침", t):
        s += 5
    if "개인정보" in t or "privacy" in t:
        s += 3
    if re.search(r"privacy|personal|policy|개인정보", h):
        s += 3
    if in_footer:
        s += 2
    if re.search(r"이용약관|terms", t) and not ("개인정보" in t or "privacy" in t):
        s -= 4
    if re.search(r"이전|old|archive|previous|history", t + " " + h):
        s -= 2
    return s


def main(argv):
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 1
    base, path = argv[1], argv[2]
    p = LinkParser()
    with open(path, encoding="utf-8", errors="replace") as f:
        p.feed(f.read())
    best = {}
    for href, text, in_footer, extra in p.links:
        s = score(href, text, in_footer, extra)
        if s is None or s <= 0:
            continue
        url = urldefrag(urljoin(base, href))[0]
        if url not in best or s > best[url][0]:
            best[url] = (s, text or "(텍스트 없음)")
    for url, (s, text) in sorted(best.items(), key=lambda kv: (-kv[1][0], kv[0])):
        print(f"{s}\t{url}\t{text}")
    return 0 if best else 4


if __name__ == "__main__":
    sys.exit(main(sys.argv))
