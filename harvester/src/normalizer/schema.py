"""Strict Pydantic V2 models for LLM structured output (bilingual MCQs).

``ParsedMCQ`` follows the spec exactly; ``ParsedMCQBatch`` wraps it because a single
text chunk of an exam booklet contains many questions.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

OptionKey = Literal["A", "B", "C", "D"]


class OptionItem(BaseModel):
    key: OptionKey
    text_en: str
    text_hi: Optional[str] = None

    @field_validator("text_en", "text_hi")
    @classmethod
    def _strip(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() if isinstance(v, str) else v


class ParsedMCQ(BaseModel):
    question_number: Optional[int] = Field(
        default=None, description="Question number as printed in the booklet (e.g. 14 for 'Q.14' or '14.')."
    )
    subject: str = Field(description="Primary subject: Indian Polity, Geography, History, UP GK, etc.")
    topic: str = Field(description="Micro-topic: e.g., Panchayati Raj, River Basins")
    difficulty: Literal["EASY", "MEDIUM", "HARD"]
    question_en: str = Field(description="Full English question stem incl. statements/lists, without the number.")
    question_hi: Optional[str] = Field(default=None, description="Full Hindi (Devanagari) question stem, if present.")
    options: List[OptionItem] = Field(description="Exactly four options A-D.")
    correct_option: OptionKey = Field(description="Best answer. If unsure, give the most likely option.")
    answer_is_printed: bool = Field(
        default=False,
        description="True only if the correct answer is explicitly printed/marked in the source text.",
    )
    explanation_en: Optional[str] = None
    explanation_hi: Optional[str] = None

    @field_validator("question_en")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("question_en is empty")
        return v

    @model_validator(mode="after")
    def _check_options(self) -> "ParsedMCQ":
        keys = [o.key for o in self.options]
        if len(keys) != len(set(keys)):
            raise ValueError(f"duplicate option keys: {keys}")
        if sorted(keys) != ["A", "B", "C", "D"]:
            raise ValueError(f"expected options A-D, got {keys}")
        self.options.sort(key=lambda o: o.key)
        return self

    @property
    def language(self) -> str:
        if self.question_hi and self.question_en:
            return "BILINGUAL"
        return "HI" if self.question_hi and not self.question_en else "EN"


class ParsedMCQBatch(BaseModel):
    questions: List[ParsedMCQ] = Field(description="Every complete MCQ found in the text chunk, in order.")


class AnswerKeyItem(BaseModel):
    question_number: int
    correct_option: Literal["A", "B", "C", "D", "X"] = Field(description="X = question deleted / bonus.")


class AnswerKeyBatch(BaseModel):
    series: Optional[str] = Field(default=None, description="Booklet series (A/B/C/D) if stated.")
    answers: List[AnswerKeyItem]
