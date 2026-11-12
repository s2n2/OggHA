"""Shared constants for Ogg Studio (the Play card's side of Ogg)."""

from ..const import DOMAIN as OGG_DOMAIN

LIBRARY = "ogg_studio_library"      # hass.data: the studio library
STORAGE_KEY = "ogg_studio"
STORAGE_VERSION = 1
SPEEDS = ["0.5x", "0.75x", "1x", "1.25x", "1.5x", "2x"]
NO_SCRIPT = "(no saved scripts)"
MAX_NAME_LENGTH = 60
MAX_SCRIPTS = 500
OLD_DOMAIN = "oggstudio"            # the separate integration this replaces

__all__ = ["OGG_DOMAIN"]
