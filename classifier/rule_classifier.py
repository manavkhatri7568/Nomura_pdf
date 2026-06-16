"""Score-based rule classifier for FX settlement emails."""

import re
from dataclasses import dataclass, field
from typing import List, Optional

from config.settings import EmailAgentConfig


@dataclass
class Classification:
    label: str                       # RELEVANT | AMBIGUOUS | IRRELEVANT
    confidence: float
    reason: str
    asset_class: str
    matched_asset: List[str] = field(default_factory=list)
    matched_subject: List[str] = field(default_factory=list)
    trade_id: Optional[str] = None


class RuleClassifier:
    def __init__(self, config: EmailAgentConfig):
        self.cfg = config
        self.asset_kws = [k.lower() for k in config.asset_keywords]
        self.subject_kws = [k.lower() for k in config.subject_keywords]
        self.neg_kws = [k.lower() for k in config.negative_keywords]
        self.trade_patterns = [re.compile(p, re.IGNORECASE) for p in config.trade_id_patterns]

    def classify(self, subject: str, body: str, attachments: Optional[List[dict]] = None) -> Classification:
        subject_l = (subject or "").lower()
        body_l = (body or "").lower()
        full = f"{subject_l} {body_l}"

        # Extract text from any PDF attachments to look for asset keywords
        pdf_text = ""
        if attachments:
            for att in attachments:
                filename = att.get("filename", "")
                if filename.lower().endswith(".pdf") and att.get("data"):
                    try:
                        import pdfplumber
                        import io
                        with pdfplumber.open(io.BytesIO(att["data"])) as pdf:
                            pages_text = []
                            for page in pdf.pages:
                                page_text = page.extract_text()
                                if page_text:
                                    pages_text.append(page_text)
                            pdf_text = " ".join(pages_text).lower()
                    except Exception:
                        pass

        full_with_pdf = f"{full} {pdf_text}"

        asset_hits = [k for k in self.asset_kws if k in full_with_pdf]
        neg_hits = [k for k in self.neg_kws if k in full_with_pdf]

        # Hard negative: noise keyword and no FX-settlement signal at all.
        if neg_hits and not asset_hits:
            return Classification(
                label="IRRELEVANT",
                confidence=0.9,
                reason=f"Negative keywords {neg_hits} and no asset signal",
                asset_class="Not Relevant",
            )

        subject_hits = [k for k in self.subject_kws if k in subject_l]
        trade_id = self.extract_trade_id(subject, body, attachments)

        score = 0.0
        reasons: List[str] = []
        if asset_hits:
            score += self.cfg.asset_weight
            reasons.append(f"asset{asset_hits}")
        if subject_hits:
            score += self.cfg.subject_weight
            reasons.append(f"subject{subject_hits}")
        if trade_id:
            score += self.cfg.trade_id_weight
            reasons.append(f"trade_id={trade_id}")

        if score >= self.cfg.relevant_threshold:
            label, conf, asset_class = "RELEVANT", min(score, 0.95), self.cfg.default_asset_class
        elif score >= self.cfg.ambiguous_threshold:
            label, conf, asset_class = "AMBIGUOUS", round(score, 2), "Unknown"
        else:
            label, conf, asset_class = "IRRELEVANT", round(1 - score, 2), "Not Relevant"

        return Classification(
            label=label,
            confidence=round(conf, 2),
            reason="; ".join(reasons) if reasons else "no signals matched",
            asset_class=asset_class,
            matched_asset=asset_hits,
            matched_subject=subject_hits,
            trade_id=trade_id,
        )

    def extract_trade_id(self, subject: str, body: str, attachments: Optional[List[dict]] = None) -> Optional[str]:
        text = f"{subject or ''} {(body or '')[: self.cfg.max_body_scan_chars]}"
        for pattern in self.trade_patterns:
            m = pattern.search(text)
            if m:
                return m.group(0)

        # Fallback to scanning PDF attachments
        if attachments:
            for att in attachments:
                filename = att.get("filename", "")
                if filename.lower().endswith(".pdf") and att.get("data"):
                    try:
                        import pdfplumber
                        import io
                        with pdfplumber.open(io.BytesIO(att["data"])) as pdf:
                            for page in pdf.pages:
                                page_text = page.extract_text()
                                if page_text:
                                    for pattern in self.trade_patterns:
                                        m = pattern.search(page_text)
                                        if m:
                                            return m.group(0)
                    except Exception:
                        pass
        return None

