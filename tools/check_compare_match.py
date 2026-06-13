"""Quick CLI check for Compare & Match.

Runs the same logic as GET /match/trades against the locally stored cases and
prints a readable report: golden-source status, the match summary, and a few
worked examples (a clean MATCH, an ENRICHED trade, and a BREAK).

Run from the project root (agentic-workflows/):

    python tools/check_compare_match.py        # uses whatever cases are stored
    python demo.py && python tools/check_compare_match.py   # fresh run first
"""

import pathlib
import sys

# Import project modules whether run as `python tools/check_compare_match.py`
# (script dir on path) or from the project root.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

# UTF-8 console so '·', '→' and counterparty names don't crash on Windows cp1252.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

from agent.compare_match import (  # noqa: E402
    BREAK, ENRICHED, MATCHED, NEAR_MATCH, UNMATCHED, CompareMatcher, GoldenSource,
)
from api.routers.match import _gather_extracted_trades  # noqa: E402
from config.settings import EmailAgentConfig  # noqa: E402
from storage.db_index import DBIndex  # noqa: E402

BAR = "=" * 70


def main() -> None:
    cfg = EmailAgentConfig()

    db = DBIndex(cfg.db_path)
    try:
        extracted = _gather_extracted_trades(cfg, db)
    finally:
        db.close()

    golden = GoldenSource(cfg.golden_source_path, sheet=cfg.golden_source_sheet, key=cfg.match_key)

    print(f"\n{BAR}\n  COMPARE & MATCH — CHECK\n{BAR}")
    print(f"  Golden source : {cfg.golden_source_path}")
    print(f"                  available={golden.available}  records={len(golden)}")
    print(f"  Extracted     : {len(extracted)} trade(s) from stored cases")
    print(f"  Match fields  : {', '.join(cfg.match_fields)}")

    if not extracted:
        print("\n  No extracted trades found. Populate cases first:")
        print("      python demo.py        (regenerate inbox + run)")
        print("      python main.py        (run against the current inbox)")
        print(f"{BAR}\n")
        return

    matcher = CompareMatcher(
        golden, key=cfg.match_key, match_fields=cfg.match_fields,
        tolerance=cfg.match_numeric_tolerance, break_threshold=cfg.match_break_threshold,
        enrich=cfg.match_enrich_enabled,
    )
    results = matcher.match(extracted)
    summary = matcher.summarize(results)

    print(f"\n  SUMMARY")
    print(f"    total              : {summary['total']}")
    for status in (MATCHED, ENRICHED, NEAR_MATCH, BREAK, UNMATCHED):
        n = summary["by_status"].get(status, 0)
        if n:
            print(f"    {status:<18} : {n}")
    print(f"    fields filled      : {summary['fields_filled']}")
    print(f"    avg confidence     : {summary['avg_confidence']}")

    def example(status: str) -> None:
        r = next((x for x in results if x.status == status), None)
        if not r:
            return
        print(f"\n  ── example: {status} ──  trade_id={r.trade_id}  confidence={r.confidence}")
        if r.filled_fields:
            shown = ", ".join(r.filled_fields[:8])
            more = "" if len(r.filled_fields) <= 8 else f"  (+{len(r.filled_fields)-8} more)"
            print(f"     populated from golden ({len(r.filled_fields)}): {shown}{more}")
        breaks = [d for d in r.diffs if not d.agree]
        if breaks:
            print(f"     breaks ({len(breaks)}):")
            for d in breaks[:5]:
                print(f"        {d.field:<18} email={d.extracted!r:<28} golden={d.golden!r}")

    for st in (MATCHED, ENRICHED, NEAR_MATCH, BREAK, UNMATCHED):
        example(st)

    print(f"\n  Per-trade (first 20):")
    print(f"    {'trade_id':<20} {'source':<18} {'status':<11} {'conf':>5} {'filled':>6}")
    for src, r in list(zip(extracted, results))[:20]:
        s = (src.get("source") or "")[:17]
        print(f"    {r.trade_id:<20} {s:<18} {r.status:<11} {r.confidence:>5} {len(r.filled_fields):>6}")
    print(f"{BAR}\n")


if __name__ == "__main__":
    main()
