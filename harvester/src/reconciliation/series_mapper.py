"""Booklet Series-Agnostic Key Mapping.

Competitive exam question booklets (e.g. UPPCS Series A, B, C, D) present the
identical set of questions in shuffled order. Mapping an answer key purely by
printed question index (`1 -> A`, `2 -> B`) across different series leads to
fatal grading errors.

This module provides two mapping mechanisms:
1. **Semantic Text / Content Hash Matching:** Matches a question stem & options
   from the target paper to the canonical question in the reference series.
2. **Matrix Mapping:** Applies an official commission transformation table
   (e.g., Series A Q1 -> Series C Q28).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.storage.deduplicator import content_hash
from src.storage.models import ExamPaper, Question, QuestionVariant

log = logging.getLogger(__name__)


@dataclass
class SeriesMappingResult:
    target_qno: int
    canonical_question_id: str
    canonical_qno: int
    matched_by: str  # HASH | MATRIX | FUZZY


class SeriesMapper:
    """Reconciles question numbering across booklet series A, B, C, D."""

    def __init__(self, session: Session):
        self.session = session

    def map_by_content_hash(
        self, target_paper_id: str, reference_paper_id: str
    ) -> Dict[int, SeriesMappingResult]:
        """Map target paper's question numbers to reference paper's question numbers

        using exact content hashes of question stems and sorted options.
        """
        ref_questions = self.session.scalars(
            select(Question).where(
                Question.paper_id == reference_paper_id,
                Question.question_number.is_not(None),
            )
        ).all()

        hash_to_ref: Dict[str, Question] = {}
        for q in ref_questions:
            if q.content_hash:
                hash_to_ref[q.content_hash] = q

        target_questions = self.session.scalars(
            select(Question).where(
                Question.paper_id == target_paper_id,
                Question.question_number.is_not(None),
            )
        ).all()

        mapping: Dict[int, SeriesMappingResult] = {}
        for tq in target_questions:
            if tq.content_hash in hash_to_ref:
                ref_q = hash_to_ref[tq.content_hash]
                mapping[tq.question_number] = SeriesMappingResult(
                    target_qno=tq.question_number,
                    canonical_question_id=ref_q.id,
                    canonical_qno=ref_q.question_number,
                    matched_by="HASH",
                )

        # Also inspect QuestionVariants (when target paper questions were deduplicated)
        variants = self.session.scalars(
            select(QuestionVariant).where(
                QuestionVariant.paper_id == target_paper_id,
                QuestionVariant.question_number.is_not(None),
            )
        ).all()
        for v in variants:
            if v.question_number in mapping:
                continue
            canonical_q = self.session.get(Question, v.question_id)
            if canonical_q and canonical_q.paper_id == reference_paper_id:
                mapping[v.question_number] = SeriesMappingResult(
                    target_qno=v.question_number,
                    canonical_question_id=canonical_q.id,
                    canonical_qno=canonical_q.question_number,
                    matched_by="HASH",
                )

        log.info(
            "Mapped %d / %d questions between %s and %s via content hash",
            len(mapping),
            len(target_questions),
            target_paper_id,
            reference_paper_id,
        )
        return mapping

    def apply_matrix_mapping(
        self,
        target_series: str,
        reference_series: str,
        matrix: Dict[int, int],  # {target_qno: reference_qno}
    ) -> Dict[int, int]:
        """Direct transformation lookup using official commission series translation tables."""
        log.info(
            "Applied official series matrix mapping (%s -> %s) for %d questions",
            target_series,
            reference_series,
            len(matrix),
        )
        return matrix
