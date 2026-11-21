"""The Connect Handy card's commands: Wi-Fi on/off, keys (to secrets.yaml), a test.

Keys go over the websocket (never a service call, which would put them in
Home Assistant's event history) and only admins may set them. The status
never contains a key, only whether each is there.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN


def _hub(hass: HomeAssistant) -> Any:
    for entry in hass.config_entries.async_entries(DOMAIN):
        hub = getattr(entry, "runtime_data", None)
        if hub is not None and hasattr(hub, "wifi"):
            return hub
    return None


@callback
def async_setup_handy_wifi_ws(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_set)
    websocket_api.async_register_command(hass, ws_keys)
    websocket_api.async_register_command(hass, ws_test)


@websocket_api.websocket_command({vol.Required("type"): "ogg/handy_wifi/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """The Wi-Fi route's status now and whenever it changes."""
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Ogg is not set up")
        return
    last: dict[str, Any] = {}

    @callback
    def push() -> None:
        status = hub.wifi.status()
        status["is_admin"] = bool(connection.user and connection.user.is_admin)
        if status != last:
            last.clear()
            last.update(status)
            connection.send_message(websocket_api.event_message(msg["id"], status))

    unsubscribe_wifi = hub.wifi.add_listener(push)
    unsubscribe_hub = hub.async_add_listener(push)

    @callback
    def unsubscribe() -> None:
        unsubscribe_wifi()
        unsubscribe_hub()

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])
    push()


@websocket_api.websocket_command({
    vol.Required("type"): "ogg/handy_wifi/set",
    vol.Optional("on"): bool,
    vol.Optional("device_key"): str,
})
@websocket_api.async_response
async def ws_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Switch the Wi-Fi route on or off (by hand), or choose which stroker is the Handy."""
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Ogg is not set up")
        return
    try:
        await hub.wifi.async_set(on=msg.get("on"), device_key=msg.get("device_key"))
    except ValueError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], hub.wifi.status())


@websocket_api.websocket_command({
    vol.Required("type"): "ogg/handy_wifi/keys",
    vol.Optional("connection_key"): str,
    vol.Optional("app_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_keys(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Save the connection key and/or Application ID to secrets.yaml."""
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Ogg is not set up")
        return
    connection_key = (msg.get("connection_key") or "").strip() or None
    app_id = (msg.get("app_id") or "").strip() or None
    if connection_key is None and app_id is None:
        connection.send_error(msg["id"], "invalid", "Enter a key to save")
        return
    try:
        await hub.wifi.async_save_keys(connection_key, app_id)
    except ValueError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    except OSError:
        connection.send_error(msg["id"], "write_failed", "Could not write secrets.yaml")
        return
    connection.send_result(msg["id"], hub.wifi.status())


@websocket_api.websocket_command({vol.Required("type"): "ogg/handy_wifi/test"})
@websocket_api.async_response
async def ws_test(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Ask the Handy servers now: on Wi-Fi? firmware, round trip, live delay."""
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Ogg is not set up")
        return
    connection.send_result(msg["id"], await hub.wifi.async_check())
