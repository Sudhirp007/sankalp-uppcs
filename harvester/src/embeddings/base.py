"""Provider-agnostic embedding interface.

No provider that calls a paid API is registered by default — embeddings are
*prepared for*, not generated. To add one later (e.g. Gemini), implement
:class:`EmbeddingProvider` and call :func:`register_provider` (see README).
"""
from __future__ import annotations

import hashlib
import math
from abc import ABC, abstractmethod
from collections.abc import Callable, Sequence


class EmbeddingProvider(ABC):
    """Contract every embedding backend must satisfy."""

    #: short provider id stored in ``question_embeddings.provider`` (e.g. 'gemini')
    name: str
    #: model id stored in ``question_embeddings.model``
    model: str
    #: optional version tag stored in ``question_embeddings.model_version``
    model_version: str | None = None
    #: task hint (e.g. 'RETRIEVAL_DOCUMENT'); stored for reproducibility
    task_type: str | None = None
    #: max texts per API call
    max_batch_size: int = 32
    #: True if calling ``embed`` costs money / quota (guards accidental runs)
    incurs_cost: bool = True

    @abstractmethod
    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """Return one vector per input text, same order. Dimensions may be provider-defined."""


class FakeEmbeddingProvider(EmbeddingProvider):
    """Deterministic, offline, zero-cost provider for tests and pipeline dry-runs.

    Vectors are derived from SHA256 of the text — *not* semantically meaningful.
    """

    name = "fake"
    model = "sha256-hash"
    model_version = "1"
    incurs_cost = False

    def __init__(self, dimensions: int = 16):
        self.dimensions = dimensions

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        out = []
        for t in texts:
            raw = hashlib.sha256(t.encode("utf-8")).digest()
            vec = [(raw[i % len(raw)] - 127.5) / 127.5 for i in range(self.dimensions)]
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            out.append([v / norm for v in vec])
        return out


_REGISTRY: dict[str, Callable[..., EmbeddingProvider]] = {"fake": FakeEmbeddingProvider}


def register_provider(name: str, factory: Callable[..., EmbeddingProvider]) -> None:
    _REGISTRY[name] = factory


def available_providers() -> list[str]:
    return sorted(_REGISTRY)


def get_provider(name: str, **kwargs) -> EmbeddingProvider:
    try:
        return _REGISTRY[name](**kwargs)
    except KeyError as exc:
        raise KeyError(f"Unknown embedding provider {name!r}; registered: {available_providers()}") from exc
