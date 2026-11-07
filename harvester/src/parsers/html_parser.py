"""HTML extraction helpers: link harvesting, table rows, and generic question cards.

``selectolax`` (fast C parser) is used for bulk parsing; BeautifulSoup is kept as a
lenient fallback for badly broken markup (e.g. ``<tobdy>`` / unclosed ``<tr>`` on
ASP.NET portals).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from selectolax.lexbor import LexborHTMLParser as HTMLParser

_WS = re.compile(r"\s+")


def clean_text(s: str | None) -> str:
    return _WS.sub(" ", s or "").strip()


def extract_pdf_links(html: str, base_url: str) -> list[tuple[str, str]]:
    """Return unique ``(absolute_url, anchor_text_or_title)`` for every PDF link."""
    tree = HTMLParser(html)
    seen: dict[str, str] = {}
    for a in tree.css("a[href]"):
        href = (a.attributes.get("href") or "").strip()
        if not href or not re.search(r"\.pdf(\?|#|$)", href, re.I):
            continue
        url = urljoin(base_url, href)
        label = clean_text(a.attributes.get("title") or a.text())
        if url not in seen or (label and len(label) > len(seen[url])):
            seen[url] = label
    return list(seen.items())


def table_rows(html: str, table_selector: str = "table") -> list[list[tuple[str, list[str]]]]:
    """Rows as lists of ``(cell_text, [hrefs])`` — tolerant of malformed tables (BeautifulSoup)."""
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    for table in soup.select(table_selector):
        for tr in table.find_all("tr"):
            cells = tr.find_all(["td"])
            if not cells:
                continue
            rows.append(
                [
                    (
                        clean_text(td.get_text(" ")),
                        [a.get("href", "").strip() for a in td.find_all("a", href=True)],
                    )
                    for td in cells
                ]
            )
    return rows


@dataclass
class QuestionCard:
    text: str  # flattened question + options (+ answer/explanation if present)
    source_selector: str


_CARD_SELECTORS = (
    "[class*=question-card]",
    "[class*=questionCard]",
    "[class*=quiz-question]",
    "[class*=mcq]",
    "[class*=question-box]",
    "div[class*=question]",
    "li[class*=question]",
)


def extract_question_cards(html: str, min_chars: int = 40) -> list[QuestionCard]:
    """Heuristic DOM extractor for online question banks.

    Picks the first selector that yields ≥ 3 cards with option-like content and
    returns their flattened text (structure is restored later by Gemini).
    """
    tree = HTMLParser(html)
    for bad in tree.css("script, style, noscript, nav, footer, header, iframe"):
        bad.decompose()
    option_like = re.compile(r"(\(?[a-dA-D1-4][).]\s)|option", re.I)
    for sel in _CARD_SELECTORS:
        nodes = tree.css(sel)
        cards = []
        for n in nodes:
            text = n.text(separator="\n", strip=True)
            if len(text) >= min_chars and option_like.search(text):
                cards.append(QuestionCard(text=text, source_selector=sel))
        # Drop cards fully contained in another (nested matches)
        cards = [c for c in cards if not any(c is not o and c.text in o.text for o in cards)]
        if len(cards) >= 3:
            return cards
    return []


def visible_text(html: str) -> str:
    tree = HTMLParser(html)
    for bad in tree.css("script, style, noscript"):
        bad.decompose()
    body = tree.body or tree.root
    return body.text(separator="\n", strip=True) if body else ""
