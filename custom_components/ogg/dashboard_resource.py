"""Publish the bundled Ogg Control Deck without a separate HACS dashboard install.

HACS installs only custom_components/ogg for an Integration repository.  Serve
our bundled JS from there and register one Lovelace module in storage mode.
Never mutate unrelated resources and never let a card error take Ogg offline.
"""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import urlsplit

from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

# Stable URL for HA dashboards; the query string is bumped on each Ogg release.
CARD_PATH = "/ogg/control-deck/ogg-control-deck-card.js"
CARD_VERSION = "2.0.0"
CARD_URL = f"{CARD_PATH}?v={CARD_VERSION}"
CARD_FILE = Path(__file__).parent / "frontend" / "ogg-control-deck-card.js"


async def async_register_control_deck(hass: HomeAssistant) -> None:
    """Register the static file and, in storage mode, the Lovelace resource.

    This runs once from Ogg async_setup, NOT once per configuration entry.
    Loading the resources before reading them is essential on HA releases
    where Lovelace storage has not yet loaded during startup.
    """
    try:
        await hass.http.async_register_static_paths(
            [StaticPathConfig(CARD_PATH, str(CARD_FILE), False)]
        )
    except RuntimeError:
        # HA retains registered HTTP routes during a configuration-entry reload.
        _LOGGER.debug("Ogg Control Deck HTTP path is already registered")

    lovelace = hass.data.get("lovelace")
    if lovelace is None:
        _LOGGER.info("Lovelace is unavailable; Ogg Control Deck resource may be added manually")
        return

    resource_mode = getattr(lovelace, "resource_mode", getattr(lovelace, "mode", "storage"))
    if resource_mode != "storage":
        _LOGGER.debug("Lovelace resources are in YAML mode; no automatic edit is possible")
        return

    resources = lovelace.resources
    # Explicitly load the saved resources BEFORE async_items/async_create_item.
    # Skipping this can overwrite existing dashboard resources on some HA releases.
    if hasattr(resources, "async_get_info"):
        await resources.async_get_info()
    elif not getattr(resources, "loaded", False):
        await resources.async_load()

    matches = [
        item
        for item in resources.async_items()
        if urlsplit(item.get("url", "")).path == CARD_PATH
    ]
    if matches:
        # Update exactly our own resource; no duplicate registration on reload.
        existing = matches[0]
        if existing.get("url") != CARD_URL or existing.get("type", "module") != "module":
            await resources.async_update_item(
                existing["id"], {"url": CARD_URL, "res_type": "module"}
            )
            _LOGGER.info("Updated Ogg Control Deck dashboard resource to %s", CARD_VERSION)
        return

    await resources.async_create_item({"url": CARD_URL, "res_type": "module"})
    _LOGGER.info("Registered Ogg Control Deck dashboard resource (%s)", CARD_VERSION)
