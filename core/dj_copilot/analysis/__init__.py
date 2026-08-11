"""Versioned, local-only audio analysis providers."""

from .provider import (
    AnalysisFeatures,
    AnalysisInterrupted,
    AnalysisProvider,
    AnalysisProviderError,
    FfmpegNumpyProvider,
    ProviderCapabilities,
)

__all__ = (
    "AnalysisFeatures",
    "AnalysisInterrupted",
    "AnalysisProvider",
    "AnalysisProviderError",
    "FfmpegNumpyProvider",
    "ProviderCapabilities",
)
