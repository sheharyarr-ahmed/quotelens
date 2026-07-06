"""Model ids are env-configurable so deploys move without code changes.
Read at call time, not import time, so tests and deploys can override."""

import os


def vision_model() -> str:
    return os.environ.get("CLAUDE_VISION_MODEL", "claude-sonnet-latest")


def text_model() -> str:
    return os.environ.get("CLAUDE_TEXT_MODEL", "claude-haiku-latest")
