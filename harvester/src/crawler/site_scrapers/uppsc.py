"""UPPSC "Previous Question Papers" scraper.

Target: https://uppsc.up.nic.in/OuterPages/PreQuesPapers.aspx?ID=PrevQues

The page is ASP.NET WebForms. The default response lists the latest year; other
years are loaded through ``__doPostBack`` on the year tabs, which we replay with
plain HTTP POSTs (``__VIEWSTATE`` / ``__EVENTVALIDATION`` round-trip) — no browser
needed. Rows link either to ``../Upload_QuestionPaper/*.pdf`` or ``Open_PDF.aspx?...``.
"""
from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass
from urllib.parse import urljoin

from selectolax.lexbor import LexborHTMLParser as HTMLParser

from src.crawler.base_crawler import BaseCrawler, save_html_snapshot
from src.parsers.html_parser import clean_text

log = logging.getLogger(__name__)

LISTING_URL = "https://uppsc.up.nic.in/OuterPages/PreQuesPapers.aspx?ID=PrevQues"

# Friendly exam aliases -> substrings searched in the row's advertisement/description.
EXAM_ALIASES: dict[str, tuple[str, ...]] = {
    "UPPCS": ("UPPER SUBORDINATE", "(PCS)"),
    "PCS": ("UPPER SUBORDINATE", "(PCS)"),
    "RO/ARO": ("SAMIKSHA ADHIKARI", "REVIEW OFFICER", "RO/ARO", "R.O./A.R.O"),
    "LOWER": ("LOWER SUBORDINATE",),
    "APO": ("ASSISTANT PROSECUTION",),
    "LT": ("TRAINED GRADUATE",),
    "GIC": ("GOVERNMENT INTER COLLEGE",),
    "PJS": ("JUDICIAL SERVICE", "CIVIL JUDGE"),
}


@dataclass
class PaperListing:
    serial: str
    advertisement: str
    year: int | None
    title: str
    paper: str
    series: str | None
    published: str
    url: str
    listing_year: int | None = None

    @property
    def stage(self) -> str:
        t = self.title.upper()
        if "MAINS" in t or "MAIN " in t:
            return "MAINS"
        if re.search(r"\bPRE\b|PRELIM|PRE\.", t):
            return "PRELIMS"
        return "UNKNOWN"

    def matches(self, exam: str | None, year: int | None, stage: str | None) -> bool:
        if year and self.year != year and self.listing_year != year:
            return False
        if stage and stage.upper() != "ANY" and self.stage not in (stage.upper(), "UNKNOWN"):
            return False
        if exam:
            hay = f"{self.title} {self.advertisement}".upper()
            needles = EXAM_ALIASES.get(exam.upper(), (exam.upper(),))
            if not any(n.upper() in hay for n in needles):
                return False
        return True

    def to_dict(self) -> dict:
        d = asdict(self)
        d["stage"] = self.stage
        return d


def _form_state(tree: HTMLParser) -> dict[str, str]:
    """Collect all hidden inputs (VIEWSTATE, EVENTVALIDATION, ...)."""
    state = {}
    for inp in tree.css("input[type=hidden]"):
        name = inp.attributes.get("name")
        if name:
            state[name] = inp.attributes.get("value") or ""
    return state


def _year_tabs(tree: HTMLParser) -> dict[int, str]:
    tabs = {}
    for a in tree.css("a.yearTab"):
        m = re.search(r"__doPostBack\('([^']+)'", (a.attributes.get("href") or "").replace("&#39;", "'"))
        txt = clean_text(a.text())
        if m and txt.isdigit():
            tabs[int(txt)] = m.group(1)
    return tabs


def _active_year(tree: HTMLParser) -> int | None:
    a = tree.css_first("a.yearTab.active")
    txt = clean_text(a.text()) if a else ""
    return int(txt) if txt.isdigit() else None


def parse_listing(html: str, base_url: str = LISTING_URL) -> list[PaperListing]:
    tree = HTMLParser(html)
    listing_year = _active_year(tree)
    out: list[PaperListing] = []
    for tr in tree.css("#ctl00_MainContent_All_data table tr"):
        tds = tr.css("td")
        if len(tds) < 9:
            continue
        link = tds[3].css_first("a[href]") or tds[8].css_first("a[href]")
        if not link:
            continue
        href = (link.attributes.get("href") or "").strip()
        title = clean_text(link.attributes.get("title") or link.text())
        year_txt = clean_text(tds[2].text())
        series = clean_text(tds[5].text())
        out.append(
            PaperListing(
                serial=clean_text(tds[0].text()).rstrip("."),
                advertisement=clean_text(tds[1].text(separator=" | ")),
                year=int(year_txt) if year_txt.isdigit() else None,
                title=title,
                paper=clean_text(tds[4].text()),
                series=None if series in ("", "-") else series,
                published=clean_text(tds[6].text()),
                url=urljoin(base_url, href),
                listing_year=listing_year,
            )
        )
    return out


class UPPSCScraper:
    def __init__(self, crawler: BaseCrawler, url: str = LISTING_URL):
        self.crawler = crawler
        self.url = url

    async def _get_initial(self) -> HTMLParser:
        resp = await self.crawler.get(self.url)
        save_html_snapshot(self.url, resp.text)
        return HTMLParser(resp.text), resp.text

    async def available_years(self) -> list[int]:
        tree, _ = await self._get_initial()
        return sorted(_year_tabs(tree), reverse=True)

    async def list_papers(self, years: list[int] | None = None) -> list[PaperListing]:
        """List papers for ``years`` (default: every year tab on the page)."""
        tree, html = await self._get_initial()
        tabs = _year_tabs(tree)
        current = _active_year(tree)
        wanted = years or sorted(tabs, reverse=True)
        results: list[PaperListing] = []
        if current in wanted:
            results.extend(parse_listing(html, self.url))
        state = _form_state(tree)
        for yr in wanted:
            if yr == current:
                continue
            target = tabs.get(yr)
            if not target:
                log.warning("Year %s not offered on UPPSC listing (available: %s)", yr, sorted(tabs))
                continue
            form = {**state, "__EVENTTARGET": target, "__EVENTARGUMENT": ""}
            resp = await self.crawler.post(
                self.url, data=form, headers={"Referer": self.url, "Origin": "https://uppsc.up.nic.in"}
            )
            save_html_snapshot(self.url, resp.text)
            page_rows = parse_listing(resp.text, self.url)
            log.info("UPPSC year %s: %d rows", yr, len(page_rows))
            results.extend(page_rows)
            state = _form_state(HTMLParser(resp.text)) or state  # keep viewstate chain valid
        return results
