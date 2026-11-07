"""Multi-Source Answer Key Reconciliation & Consensus Engine.

Cross-verifies answer keys across multiple independent sources (Official Final,
Official Provisional, Drishti, Dhyeya, Youth Competition Times, etc.).

Protocols:
1. All sources agree -> confidence_score = 1.0, status = VERIFIED.
2. Contested / Disagreed -> compute consensus probability, status = DISPUTED,
   log conflicting sources into dispute_logs table.
3. Officially Cancelled / Dropped ('X') -> status = CANCELED, grace marks awarded.
"""
from __future__ import annotations

import json
import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.storage.models import DisputeLog, Question, utcnow

log = logging.getLogger(__name__)


@dataclass
class SourceAnswer:
    source_name: str
    source_type: str  # OFFICIAL_FINAL | OFFICIAL_PROVISIONAL | THIRD_PARTY
    correct_option: str  # A | B | C | D | X
    rationale: Optional[str] = None


@dataclass
class ReconciliationOutcome:
    question_id: str
    question_number: Optional[int]
    chosen_option: str
    source_key_type: str
    confidence_score: float
    status: str  # VERIFIED | DISPUTED | CANCELED | PENDING
    is_disputed: bool = False
    dispute_log_id: Optional[str] = None
    notes: Optional[str] = None


class ConsensusEngine:
    def __init__(self, session: Session):
        self.session = session

    def reconcile_question(
        self,
        question: Question,
        answers: List[SourceAnswer],
    ) -> ReconciliationOutcome:
        """Reconcile answers from multiple sources for a single question."""
        if not answers:
            return ReconciliationOutcome(
                question_id=question.id,
                question_number=question.question_number,
                chosen_option=question.correct_option,
                source_key_type="LLM_INFERRED",
                confidence_score=0.5,
                status=question.status or "PENDING",
            )

        # 1. Check for official final key (overrides all third-party opinions)
        official_final = next((a for a in answers if a.source_type == "OFFICIAL_FINAL"), None)
        if official_final:
            chosen = official_final.correct_option.upper()
            status = "CANCELED" if chosen == "X" else "VERIFIED"
            notes = "Officially canceled/dropped question" if chosen == "X" else "Verified by official final key"
            return ReconciliationOutcome(
                question_id=question.id,
                question_number=question.question_number,
                chosen_option=chosen,
                source_key_type="OFFICIAL_FINAL",
                confidence_score=1.0,
                status=status,
                notes=notes,
            )

        # 2. Check for official provisional key
        official_prov = next((a for a in answers if a.source_type == "OFFICIAL_PROVISIONAL"), None)
        if official_prov:
            chosen = official_prov.correct_option.upper()
            status = "CANCELED" if chosen == "X" else "VERIFIED"
            return ReconciliationOutcome(
                question_id=question.id,
                question_number=question.question_number,
                chosen_option=chosen,
                source_key_type="OFFICIAL_PROVISIONAL",
                confidence_score=0.95,
                status=status,
                notes="Set by official provisional key",
            )

        # 3. Third-party multi-source consensus
        options = [a.correct_option.upper() for a in answers]
        counts = Counter(options)
        total_sources = len(answers)

        # If any source reported canceled ('X')
        if "X" in counts and counts["X"] >= total_sources / 2:
            return ReconciliationOutcome(
                question_id=question.id,
                question_number=question.question_number,
                chosen_option="X",
                source_key_type="THIRD_PARTY_CONSENSUS",
                confidence_score=round(counts["X"] / total_sources, 2),
                status="CANCELED",
                notes="Consensus indicates question was dropped/cancelled.",
            )

        # Unanimous agreement across all sources
        if len(counts) == 1:
            chosen = options[0]
            return ReconciliationOutcome(
                question_id=question.id,
                question_number=question.question_number,
                chosen_option=chosen,
                source_key_type="THIRD_PARTY_CONSENSUS",
                confidence_score=1.0,
                status="VERIFIED",
                notes=f"Unanimous agreement across {total_sources} independent sources.",
            )

        # Split / Disputed decision
        most_common_option, most_common_count = counts.most_common(1)[0]
        consensus_prob = round(most_common_count / total_sources, 2)
        conflicts = {a.source_name: a.correct_option for a in answers}

        dispute_sources_str = ", ".join(f"{s}: {opt}" for s, opt in conflicts.items())
        notes = f"Dispute among sources: {dispute_sources_str}"

        return ReconciliationOutcome(
            question_id=question.id,
            question_number=question.question_number,
            chosen_option=most_common_option,
            source_key_type="THIRD_PARTY",
            confidence_score=consensus_prob,
            status="DISPUTED",
            is_disputed=True,
            notes=notes,
        )

    def apply_reconciliation(
        self,
        paper_id: str,
        source_key_map: Dict[int, List[SourceAnswer]],  # qno -> [SourceAnswer]
    ) -> Dict[str, int]:
        """Apply multi-source reconciliation across all questions of a paper."""
        questions = self.session.scalars(
            select(Question).where(
                Question.paper_id == paper_id,
                Question.question_number.is_not(None),
            )
        ).all()

        stats = {"reconciled": 0, "verified": 0, "disputed": 0, "canceled": 0}

        for q in questions:
            answers = source_key_map.get(q.question_number, [])
            outcome = self.reconcile_question(q, answers)

            q.correct_option = outcome.chosen_option
            q.source_key_type = outcome.source_key_type
            q.confidence_score = outcome.confidence_score
            q.status = outcome.status
            q.answer_source = outcome.source_key_type

            if outcome.is_disputed:
                conflicts = {a.source_name: a.correct_option for a in answers}
                dispute = DisputeLog(
                    question_id=q.id,
                    disputed_sources=", ".join(conflicts.keys()),
                    conflicting_keys_json=json.dumps(conflicts),
                    committee_notes=outcome.notes,
                    status_flag="PENDING_REVIEW",
                )
                self.session.add(dispute)
                stats["disputed"] += 1
            elif outcome.status == "VERIFIED":
                stats["verified"] += 1
            elif outcome.status == "CANCELED":
                stats["canceled"] += 1

            stats["reconciled"] += 1

        self.session.flush()
        log.info("Reconciled %s: %s", paper_id, stats)
        return stats
