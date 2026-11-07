"""Lightweight layout regressions that do not need Home Assistant dependencies."""
from pathlib import Path


def test_compact_master_layout_preserved():
    source = (Path(__file__).resolve().parents[1] / "custom_components/ogg/frontend/ogg-control-deck-card.js").read_text()
    assert "grid-template-columns:repeat(2,minmax(0,1fr))" in source
    assert "master-bottom" in source
    assert "master-label" in source
    assert 'card v0.1.14' in source
    assert 'id="server"' in source and 'id="ogg"' in source
    assert "server-settings" in source and "ogg-settings" in source
