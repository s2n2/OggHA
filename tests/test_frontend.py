"""HACS-bundled dashboard resource registration, with no live server needed."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.ogg import async_setup
from custom_components.ogg.dashboard_resource import (
    CARD_FILE,
    CARD_PATH,
    CARD_VERSION,
    CARD_URL,
    async_register_control_deck,
)


class Resources:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.loaded = False
        self.loads = 0
        self.creates = []
        self.updates = []

    async def async_get_info(self):
        self.loaded = True
        self.loads += 1
        return {"resources": len(self.rows)}

    def async_items(self):
        assert self.loaded, "Never touch unloaded Lovelace resources"
        return list(self.rows)

    async def async_create_item(self, item):
        assert self.loaded
        self.creates.append(item)
        self.rows.append({"id": str(len(self.rows) + 1), "type": "module", **item})

    async def async_update_item(self, item_id, item):
        assert self.loaded
        self.updates.append((item_id, item))
        for row in self.rows:
            if row["id"] == item_id:
                row.update(item)
                row["type"] = "module"
                return
        raise AssertionError("Unknown resource")


def fake_hass(resources=None, mode="storage"):
    return SimpleNamespace(
        http=SimpleNamespace(async_register_static_paths=AsyncMock()),
        data={"lovelace": SimpleNamespace(resource_mode=mode, resources=resources or Resources())},
    )


@pytest.mark.asyncio
async def test_installs_from_integration_folder_and_registers_once():
    resources = Resources([{"id": "existing", "url": "/some-other-card.js", "type": "module"}])
    hass = fake_hass(resources)
    assert CARD_FILE.is_file()
    await async_register_control_deck(hass)
    assert resources.loads == 1
    assert resources.rows[0]["url"] == "/some-other-card.js"
    assert resources.creates == [{"url": CARD_URL, "res_type": "module"}]
    route = hass.http.async_register_static_paths.await_args.args[0][0]
    assert route.url_path == CARD_PATH
    assert route.path == str(CARD_FILE)
    assert route.cache_headers is False

    await async_register_control_deck(hass)
    assert len(resources.creates) == 1
    assert resources.updates == []


@pytest.mark.asyncio
async def test_updates_old_version_but_leaves_unrelated_cards_untouched():
    resources = Resources([
        {"id": "old", "url": CARD_PATH + "?v=0.1.2", "type": "module"},
        {"id": "other", "url": "/something-else.js", "type": "module"},
    ])
    await async_register_control_deck(fake_hass(resources))
    assert resources.creates == []
    assert resources.updates == [("old", {"url": CARD_URL, "res_type": "module"})]
    assert resources.rows[1]["url"] == "/something-else.js"


@pytest.mark.asyncio
async def test_yaml_mode_serves_file_without_modifying_resources():
    resources = Resources()
    hass = fake_hass(resources, mode="yaml")
    await async_register_control_deck(hass)
    hass.http.async_register_static_paths.assert_awaited_once()
    assert resources.loads == 0
    assert resources.creates == []


@pytest.mark.asyncio
async def test_ogg_still_initialises_when_card_registration_fails():
    with patch(
        "custom_components.ogg.async_register_control_deck",
        new=AsyncMock(side_effect=OSError("frontend unavailable")),
    ):
        assert await async_setup(fake_hass(), {}) is True


def test_card_version_matches_integration_manifest():
    manifest = CARD_FILE.parent.parent / "manifest.json"
    assert json.loads(manifest.read_text(encoding="utf-8"))["version"] == CARD_VERSION
