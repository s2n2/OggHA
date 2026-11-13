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
CARD_VERSION = "3.2.0"
CARD_URL = f"{CARD_PATH}?v={CARD_VERSION}"
CARD_FILE = Path(__file__).parent / "frontend" / "ogg-control-deck-card.js"


# The Play card (was the OggStudio integration's card). Its old resource is
# removed once that integration is gone, so dashboards load only this one.
STUDIO_PATH = "/ogg/studio/oggstudio-card.js"
STUDIO_VERSION = "3.2.0"
STUDIO_FILE = Path(__file__).parent / "frontend" / "oggstudio-card.js"
OLD_STUDIO_PATH = "/oggstudio/oggstudio-card.js"


async def async_register_control_deck(hass: HomeAssistant) -> None:
    """Register the Control Deck and the Play card (static files and, in storage
    mode, their Lovelace resources).

    This runs from Ogg async_setup (and entry setup), never more than needed:
    registration is idempotent. Loading the resources before reading them is
    essential on HA releases where Lovelace storage has not yet loaded during
    startup.
    """
    cards = [(CARD_PATH, CARD_URL, CARD_FILE, "Ogg Control Deck")]
    if STUDIO_FILE.exists():
        cards.append((STUDIO_PATH, f"{STUDIO_PATH}?v={STUDIO_VERSION}", STUDIO_FILE, "Ogg Play card"))
    for path, _url, file, label in cards:
        try:
            await hass.http.async_register_static_paths([StaticPathConfig(path, str(file), False)])
        except RuntimeError:
            # HA retains registered HTTP routes during a configuration-entry reload.
            _LOGGER.debug("%s HTTP path is already registered", label)

    lovelace = hass.data.get("lovelace")
    if lovelace is None:
        _LOGGER.info("Lovelace is unavailable; Ogg card resources may be added manually")
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

    for path, url, _file, label in cards:
        matches = [item for item in resources.async_items() if urlsplit(item.get("url", "")).path == path]
        if matches:
            # Update exactly our own resource; no duplicate registration on reload.
            existing = matches[0]
            if existing.get("url") != url or existing.get("type", "module") != "module":
                await resources.async_update_item(existing["id"], {"url": url, "res_type": "module"})
                _LOGGER.info("Updated %s dashboard resource to %s", label, url)
            continue
        await resources.async_create_item({"url": url, "res_type": "module"})
        _LOGGER.info("Registered %s dashboard resource (%s)", label, url)

    # The separate OggStudio integration's card, once that integration is gone.
    entries = getattr(hass, "config_entries", None)
    if entries is not None and not entries.async_entries("oggstudio"):
        for item in list(resources.async_items()):
            if urlsplit(item.get("url", "")).path == OLD_STUDIO_PATH:
                await resources.async_delete_item(item["id"])
                _LOGGER.info("Removed the old OggStudio card resource")
