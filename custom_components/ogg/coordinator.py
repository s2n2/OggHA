"""Ogg's independent connection lifecycle and serialised device runners.

An absent server is a state, not a configuration-entry setup error. Only
configured locations are tried. Ogg retains a short-lived, non-persistent run
intention while disconnected and resumes only after an acknowledged stop.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from dataclasses import dataclass
from collections.abc import Callable, Coroutine
from contextlib import suppress
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.storage import Store

from .const import DEFAULT_PULSE_DURATION, DOMAIN, STORAGE_VERSION
from .endpoints import Candidate, resolve_candidates, validate_config
from .identity import load_devices, match_device, new_device_key
from .migration import async_migrate_device_registry
from .models import OggDevice, physical_address, useful_label
from .patterns import MOTOR_MODES, NATIVE_PATTERNS, SOFTWARE_PATTERNS, build_classic_packet, sample
from .protocol import ButtplugConnection, CommandError, ProtocolError

_LOGGER = logging.getLogger(__name__)
_PATTERNS = set(SOFTWARE_PATTERNS) | set(NATIVE_PATTERNS)
RECONNECT_GRACE_SECONDS = 30.0
# After a completed pulse, repeat STOP even when the server acknowledged it:
# a queued intensity update or a device-specific BLE write may arrive late.
# Offsets are measured from the first STOP acknowledgement. Two close STOPs
# at each checkpoint help stop both software and native firmware patterns.
PULSE_STOP_BACKUP_DELAYS = (0.20, 2.0, 2.20, 10.0, 10.20)
# What a device does when it (re)connects, before normal stop/resume.
CONNECT_FEEDBACK_OPTIONS = ("silent", "short_pulse")
CONNECT_FEEDBACK_LEVEL = 0.3
CONNECT_FEEDBACK_SECONDS = 0.2
# Spread "all devices" commands so one Bluetooth proxy is not hit by a burst.
ALL_DEVICES_STAGGER_SECONDS = 0.05
IDENTITY_TIMEOUT_SECONDS = 3.0


@dataclass
class DesiredOutput:
    """Transient requested state, independent of physical route and session.

    This is deliberately not written to storage: an Ogg/HA restart must never
    replay an old Run or Pulse. Pulse deadlines use monotonic elapsed time and
    therefore *include* time spent disconnected.
    """

    mode: str
    deadline: float | None
    lost_at: float | None = None
    command_serial: int = 0

    def may_resume(self, now: float) -> bool:
        return (
            self.lost_at is not None
            and 0 <= now - self.lost_at <= RECONNECT_GRACE_SECONDS
            and (self.deadline is None or now < self.deadline)
        )


class OggHub:
    """One local controller with up to ten alternative server locations."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.config = validate_config({**entry.data, **entry.options})
        self.devices: dict[str, OggDevice] = {}
        self._identity_aliases: dict[str, str] = {}
        self.enabled = False
        self.status = "disabled"
        self.server_ip: str | None = None
        self.server_url: str | None = None
        self.last_error: str | None = None
        self.pulse_duration = DEFAULT_PULSE_DURATION
        self._store = Store[dict[str, Any]](hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}")
        self._client: ButtplugConnection | None = None
        self._ready = False
        self._candidate: Candidate | None = None
        self._last_source: str | None = None
        self._monitor: asyncio.Task | None = None
        self._runs: dict[str, asyncio.Task] = {}
        self._stop_backups: dict[str, asyncio.Task] = {}
        self._command_serials: dict[str, int] = {}
        self._desired_outputs: dict[str, DesiredOutput] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._listeners: set[Callable[[], None]] = set()
        self._event_tasks: set[asyncio.Task] = set()
        self._wake = asyncio.Event()
        self._master_lock = asyncio.Lock()
        self._scan_active = False
        self._force_scan = False
        self._shutting_down = False
        self._operation_epoch = 0
        self._last_battery_poll = 0.0
        # DeviceIndex -> Bluetooth address, from IntiHA's /intiha/devices side
        # channel. Empty for servers without it (e.g. Intiface Central).
        self._addresses: dict[int, str] = {}
        self._address_client: ButtplugConnection | None = None
        self.connect_feedback = "silent"
        self._unsubscribe_ips: Callable[[], None] | None = None
        self._shutdown_task: asyncio.Task | None = None

    @property
    def connected(self) -> bool:
        return self._ready and self._client is not None and self._client.connected

    @property
    def connected_count(self) -> int:
        return sum(device.connected for device in self.devices.values()) if self.connected else 0

    @callback
    def async_add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    @callback
    def _notify(self) -> None:
        for listener in tuple(self._listeners):
            try:
                listener()
            except Exception:
                _LOGGER.exception("An Ogg state listener failed")

    async def async_initialize(self) -> None:
        """Restore configuration and cached entities without any network IO."""
        saved = await self._store.async_load() or {}
        self.enabled = saved.get("enabled") is True
        value = saved.get("pulse_duration", DEFAULT_PULSE_DURATION)
        if isinstance(value, (int, float)) and math.isfinite(value) and 0.1 <= value <= 300:
            self.pulse_duration = float(value)
        if saved.get("connect_feedback") in CONNECT_FEEDBACK_OPTIONS:
            self.connect_feedback = saved["connect_feedback"]
        self._last_source = saved.get("last_source")
        self.devices, new_aliases = load_devices(saved.get("devices", []))
        for device in self.devices.values():
            self._sanitise_settings(device)
        saved_aliases = saved.get("identity_aliases", {})
        aliases = {
            key: target
            for key, target in (saved_aliases.items() if isinstance(saved_aliases, dict) else [])
            if isinstance(key, str) and isinstance(target, str)
        }
        aliases.update(new_aliases)
        self._identity_aliases.clear()
        for old_key, target in aliases.items():
            seen = {old_key}
            while target in aliases and target not in seen:
                seen.add(target)
                target = aliases[target]
            if old_key not in self.devices and target in self.devices and target not in seen:
                self._identity_aliases[old_key] = target
        if new_aliases:
            # Persist the canonical identities and retry map first. Registry
            # cleanup is idempotent if HA stops part way through an upgrade.
            await self._store.async_save(self._saved_data())
        await async_migrate_device_registry(self.hass, self.entry, self._identity_aliases)
        self.status = "searching" if self.enabled else "disabled"

    @callback
    def start(self) -> None:
        """Start only background tasks, so HA startup never waits for a server."""
        sensors = self.config["sensor_entities"]
        if sensors and self._unsubscribe_ips is None:
            self._unsubscribe_ips = async_track_state_change_event(
                self.hass, sensors, self._ip_changed
            )
        if self.enabled:
            self._ensure_monitor()

    @callback
    def _ip_changed(self, _event: Any) -> None:
        if self.enabled:
            self._wake.set()

    @callback
    def _ensure_monitor(self) -> None:
        if not self._shutting_down and (self._monitor is None or self._monitor.done()):
            self._monitor = self.entry.async_create_background_task(
                self.hass, self._connection_loop(), "ogg_connection_manager"
            )

    def _spawn_event(self, coroutine: Coroutine[Any, Any, None]) -> None:
        if self._shutting_down:
            coroutine.close()
            return
        task = self.entry.async_create_background_task(self.hass, coroutine, "ogg_device_event")
        self._event_tasks.add(task)
        task.add_done_callback(self._event_done)

    def _event_done(self, task: asyncio.Task) -> None:
        self._event_tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            _LOGGER.error("An Ogg device event could not be completed")

    def _saved_data(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "pulse_duration": self.pulse_duration,
            "connect_feedback": self.connect_feedback,
            "last_source": self._last_source,
            "identity_aliases": dict(self._identity_aliases),
            "devices": [device.stored() for device in self.devices.values()],
        }

    def _save_later(self) -> None:
        if not self._shutting_down:
            self._store.async_delay_save(self._saved_data, 1)

    async def async_set_enabled(self, value: bool) -> None:
        """Master switch enables discovery; turning it off also stops outputs."""
        async with self._master_lock:
            self.enabled = bool(value)
            if self.enabled and not self._shutting_down:
                self.last_error = None
                self.status = "connected" if self.connected else "searching"
                self._ensure_monitor()
                self._wake.set()
            else:
                self._operation_epoch += 1
                await self.async_all_stop()
                await self._cancel_monitor()
                self.status = "disabled"
                self.server_ip = None
                self.server_url = None
            self._save_later()
            self._notify()

    async def async_rescan(self) -> None:
        """Refresh/search now, while respecting the master switch."""
        if not self.enabled:
            raise HomeAssistantError("Turn on Ogg before searching for devices")
        self._force_scan = True
        self._wake.set()
        self._ensure_monitor()

    def _new_client(self) -> ButtplugConnection:
        """Bind callbacks to one session without changing transport internals."""
        client = ButtplugConnection(
            async_get_clientsession(self.hass),
            lambda kind, payload: self._on_event(client, kind, payload),
            connect_timeout=3,
            request_timeout=5,
        )
        return client

    async def _connection_loop(self) -> None:
        """Try configured locations, then maintain the one connected session."""
        had_connection = False
        try:
            while self.enabled and not self._shutting_down:
                self._wake.clear()
                candidates = resolve_candidates(self.config, self.hass.states)
                if self._last_source:
                    candidates.sort(key=lambda item: item.source != self._last_source)
                self.status = "reconnecting" if had_connection else "searching"
                if not candidates:
                    self.status = "no_endpoints"
                    self.last_error = "Waiting for a valid configured address"
                self._notify()
                established = False
                for candidate in candidates:
                    if not self.enabled or self._shutting_down:
                        break
                    self.status = "connecting"
                    self._notify()
                    client = self._new_client()
                    try:
                        await client.connect(candidate.url)
                    except ProtocolError as err:
                        # A failed WebSocket/Buttplug handshake is not a device
                        # failure. Keep the integration loaded and identify the
                        # failing phase rather than masking every failure as
                        # 'no server responding'. Never log server-supplied
                        # device names or addresses from command Error bodies.
                        self.last_error = str(err)
                        _LOGGER.warning("Ogg could not open a Buttplug v3 session: %s", type(err).__name__)
                        await client.close()
                        continue
                    self._client = client
                    self._ready = False
                    self._candidate = candidate
                    self._last_source = candidate.source
                    self.server_url = candidate.url
                    self.server_ip = client.peer_ip
                    self.last_error = None
                    self._scan_active = False
                    self._last_battery_poll = 0
                    self._addresses = {}
                    self._address_client = None
                    self._reconcile_devices(client)
                    await self._refresh_addresses(client)
                    try:
                        # Raw firmware patterns can outlive a lost socket and
                        # bypass the server's normal actuator-state cache.
                        # Keep command entities unavailable until recovery off
                        # commands have been attempted on this new session.
                        await self._recover_native_outputs(client)
                        if not self.enabled or self._shutting_down:
                            break
                        if not client.connected:
                            raise ProtocolError("Recovery stop was not acknowledged")
                        self._ready = True
                        self.status = "connected"
                        self._save_later()
                        self._notify()
                        established = had_connection = True
                        # All first-session devices have received a stop before
                        # any remembered intention is eligible for resumption.
                        self._schedule_pending_resumes(client)
                        await self._connected_loop(client)
                    except ProtocolError:
                        if self._ready or self.last_error is None:
                            self.last_error = "Server connection interrupted; searching again"
                    finally:
                        await self._disconnect(client)
                    break
                if not self.enabled or self._shutting_down:
                    break
                self.status = (
                    "reconnecting"
                    if had_connection
                    else ("searching" if candidates else "no_endpoints")
                )
                if candidates and not established and self.last_error is None:
                    self.last_error = "No configured server is responding"
                self._notify()
                if established:
                    # A loss or changed phone address triggers an immediate
                    # first retry, then failed rounds use the configured delay.
                    continue
                await self._wait_for_wake(float(self.config["scan_interval"]))
        except asyncio.CancelledError:
            raise
        except Exception:
            # Preserve the loaded integration and permit a user-triggered retry
            # even when a future server returns an unexpected capability shape.
            self.last_error = "Connection manager encountered an error; retrying"
            _LOGGER.exception("Ogg connection manager failed")
            if self.enabled and not self._shutting_down:
                self.status = "error"
                self._notify()
        finally:
            client = self._client
            if client is not None:
                await self._disconnect(client)
            if not self.enabled:
                self.status = "disabled"
            self._notify()
            if self.enabled and not self._shutting_down and self.status == "error":
                # Separate retry task avoids creating an orphan listener inside
                # the manager's own cancellation path.
                self._spawn_event(self._restart_after_error())

    async def _refresh_addresses(self, client: ButtplugConnection) -> None:
        """Learn DeviceIndex -> Bluetooth address from IntiHA, if offered.

        Buttplug v3 carries no physical identifier, so the same toy seen via
        IntiHA and via another server (or after a reconnect) could only be
        matched by name. IntiHA publishes the mapping on its client port. Any
        other server simply has no such page; that is not an error.
        """
        candidate = self._candidate
        if candidate is None or client is not self._client:
            return
        parts = urlsplit(candidate.url)
        scheme = "https" if parts.scheme == "wss" else "http"
        url = urlunsplit((scheme, parts.netloc, "/intiha/devices", "", ""))
        mapping: dict[int, str] = {}
        try:
            async with asyncio.timeout(IDENTITY_TIMEOUT_SECONDS):
                response = await async_get_clientsession(self.hass).get(url)
                if response.status == 200:
                    body = await response.json(content_type=None)
                    for item in body.get("devices", []) if isinstance(body, dict) else []:
                        index = item.get("DeviceIndex") if isinstance(item, dict) else None
                        address = physical_address({"BluetoothAddress": item.get("address")}) if isinstance(item, dict) else ""
                        if isinstance(index, int) and not isinstance(index, bool) and address:
                            mapping[index] = address
                response.release()
        except (TimeoutError, aiohttp.ClientError, ValueError):
            mapping = {}
        if client is not self._client:
            return
        changed = mapping != self._addresses or self._address_client is not client
        self._addresses = mapping
        self._address_client = client
        if changed:
            self._reconcile_devices(client)
            self._notify()

    async def _restart_after_error(self) -> None:
        # HA may eagerly start a background task. Always let the failing
        # manager finish before checking whether another manager can start.
        await asyncio.sleep(0)
        await self._wait_for_wake(float(self.config["scan_interval"]))
        if self.enabled and not self._shutting_down:
            self._ensure_monitor()

    async def _connected_loop(self, client: ButtplugConnection) -> None:
        while self.enabled and client.connected and not self._shutting_down:
            self._wake.clear()
            if self._candidate is not None:
                # A temporarily unavailable phone sensor does not break a
                # healthy connection. A new valid address does trigger failover.
                current = next(
                    (
                        item
                        for item in resolve_candidates(self.config, self.hass.states)
                        if item.source == self._candidate.source
                    ),
                    None,
                )
                if current is not None and current.url != self._candidate.url:
                    return
            if self._force_scan:
                self._force_scan = False
                if self._scan_active:
                    with suppress(CommandError):
                        await client.stop_scanning()
                self._scan_active = False
            if not self._scan_active:
                try:
                    # ScanningFinished can arrive before the acknowledgement.
                    # Set this before awaiting so that event remains authoritative.
                    self._scan_active = True
                    await client.start_scanning()
                except CommandError:
                    self._scan_active = False
                    # Some servers scan continuously or omit scan support. A
                    # working connection is still useful for known devices.
                    self.last_error = "Server did not start a new discovery scan"
            await client.request("RequestDeviceList")
            self._reconcile_devices(client)
            await self._refresh_addresses(client)
            # A server may list a known device before its BLE session is ready.
            # An unsuccessful stop must block only that device, not Ogg's
            # WebSocket. Retry readiness on future device-list refreshes.
            retry_stops = [
                (device.key, device.generation)
                for device in self.devices.values()
                if device.connected and device.recovering
            ]
            if retry_stops:
                await self._recover_native_outputs(client, retry_stops)
            if time.monotonic() - self._last_battery_poll >= 60:
                await self._read_batteries(client)
                self._last_battery_poll = time.monotonic()
            self._notify()
            wake_task = asyncio.create_task(self._wake.wait())
            close_task = asyncio.create_task(client.await_closed())
            try:
                await asyncio.wait(
                    [wake_task, close_task],
                    timeout=float(self.config["scan_interval"]),
                    return_when=asyncio.FIRST_COMPLETED,
                )
            finally:
                for task in (wake_task, close_task):
                    task.cancel()
                await asyncio.gather(wake_task, close_task, return_exceptions=True)

    async def _wait_for_wake(self, seconds: float) -> None:
        with suppress(TimeoutError):
            async with asyncio.timeout(seconds):
                await self._wake.wait()

    def _on_event(self, client: ButtplugConnection, kind: str, _payload: dict[str, Any]) -> None:
        if client is not self._client or self._shutting_down:
            return
        if kind in {"DeviceAdded", "DeviceRemoved", "DeviceList"}:
            self._reconcile_devices(client)
            if kind == "DeviceAdded":
                self._spawn_event(self._refresh_addresses(client))
        elif kind == "ScanningFinished":
            self._scan_active = False
        self._notify()

    def _reconcile_devices(self, client: ButtplugConnection) -> None:
        if self._candidate is None or client is not self._client:
            return
        source = self._candidate.source
        current_keys: set[str] = set()
        changed = False
        addresses = self._addresses if self._address_client is client else {}
        current_raws = [
            {**raw, "BluetoothAddress": addresses[raw["DeviceIndex"]]}
            if raw.get("DeviceIndex") in addresses and not physical_address(raw)
            else raw
            for raw in client.devices.values()
            if isinstance(raw.get("DeviceMessages"), dict)
        ]
        seen_macs: set[str] = set()
        for raw in current_raws:
            mac = physical_address(raw)
            if mac and mac in seen_macs:
                _LOGGER.warning("Server advertised duplicate Bluetooth address %s; ignoring second route", mac)
                continue
            if mac:
                seen_macs.add(mac)
            device = match_device(self.devices, source, raw, current_keys, current_raws)
            name = str(raw.get("DeviceDisplayName") or raw.get("DeviceName") or "Device")
            if device is None:
                key = new_device_key(self.devices, source, raw)
                device = self.devices[key] = OggDevice(key, name, source, raw)
                changed = True
            key = device.key
            current_keys.add(key)
            route_changed = device.source != source or device.index != raw["DeviceIndex"]
            capabilities_changed = device.messages != raw["DeviceMessages"]
            live_rebind = device.connected and (route_changed or capabilities_changed)
            newly_connected = not device.connected or live_rebind
            if newly_connected:
                device.generation += 1
                device.native_failed = device.battery_failed = False
                device.battery = None
            if newly_connected:
                self._cancel_stop_backups(key)
                # Record a loss once. A route/index change is not a new command
                # and must not restart a disconnected pulse's deadline.
                self._mark_intention_lost(key)
                self._operation_epoch += 1
                if (task := self._runs.get(key)) is not None:
                    task.cancel()
                device.running = False
                device.mode = "idle"
                device.remaining = None
                device.aux_values.clear()
                device.recovering = True
            if route_changed or device.raw != raw or (useful_label(name) and device.alias != name):
                changed = True
            device.update_binding(source, raw)
            device.connected = True
            if not device.battery_supported:
                device.battery = None
            if newly_connected and self._ready:
                # Every reconnected device (not just native patterns) must be
                # stopped before its switch or pulse button becomes available.
                self._spawn_event(self._recover_native_outputs(client, [(key, device.generation)]))
        for key, device in tuple(self.devices.items()):
            if key not in current_keys and device.connected:
                self._cancel_stop_backups(key)
                self._mark_intention_lost(key)
                device.connected = False
                device.recovering = False
                device.generation += 1
                device.battery = None
                # Mark offline before cancellation so a reused index cannot
                # receive the old runner's stop command.
                task = self._runs.get(key)
                if task is not None:
                    task.cancel()
                self._spawn_event(self._stop_removed(key, device.generation))
        if changed:
            self._save_later()

    async def _stop_removed(self, key: str, generation: int) -> None:
        async with self._lock(key):
            device = self.devices[key]
            if device.generation == generation and not device.connected:
                await self._stop_locked(device, send_stop=False, preserve_desired=True)
        self._notify()

    def _mark_intention_lost(self, key: str) -> None:
        """Start a single 30-second grace window at the *first* loss."""
        intent = self._desired_outputs.get(key)
        if intent is not None and intent.lost_at is None:
            intent.lost_at = time.monotonic()

    def _schedule_pending_resumes(
        self, client: ButtplugConnection, targets: list[tuple[str, int]] | None = None
    ) -> None:
        """Queue Ogg-owned recovery regardless of which server is in use."""
        if not self.enabled or not self.connected or self._shutting_down:
            return
        if targets is None:
            targets = [
                (device.key, device.generation)
                for device in self.devices.values()
                if device.connected
            ]
        for key, generation in targets:
            intent = self._desired_outputs.get(key)
            if intent is not None and intent.lost_at is not None:
                self._spawn_event(self._resume_after_verified_stop(client, key, generation))

    async def _resume_after_verified_stop(
        self, client: ButtplugConnection, key: str, generation: int
    ) -> None:
        """Resume only a live intention, after this session's STOP succeeded."""
        async with self._lock(key):
            device = self.devices.get(key)
            intent = self._desired_outputs.get(key)
            if device is None or intent is None or intent.lost_at is None:
                return
            if (
                not self.enabled
                or self._shutting_down
                or not device.commands_enabled
                or not device.motor_count
            ):
                self._desired_outputs.pop(key, None)
                self._notify()
                return
            # Another connection, recovery or stop request may supersede the
            # one that scheduled this callback. No output may bypass STOP.
            if (
                client is not self._client
                or not self.connected
                or not device.connected
                or device.recovering
                or device.generation != generation
            ):
                return
            if not intent.may_resume(time.monotonic()):
                self._desired_outputs.pop(key, None)
                device.running = False
                device.mode = "idle"
                device.remaining = None
                self._notify()
                return
            if (old := self._runs.pop(key, None)) is not None:
                if old is not asyncio.current_task():
                    old.cancel()
                    await asyncio.gather(old, return_exceptions=True)
            # Recovery STOP has already been acknowledged by _recover_native_outputs.
            # Never reset the pulse deadline, even if the server has changed.
            intent.lost_at = None
            device.last_error = None
            device.running = True
            device.mode = intent.mode
            device.remaining = (
                max(0.0, intent.deadline - time.monotonic())
                if intent.deadline is not None else None
            )
            self._runs[key] = self.entry.async_create_background_task(
                self.hass, self._run_device(device, client, intent), "ogg_device_pattern"
            )
            self._notify()

    async def _read_batteries(self, client: ButtplugConnection) -> None:
        for device in tuple(self.devices.values()):
            feature = device.battery_sensor
            if not device.connected or feature is None or device.battery_failed:
                continue
            index, details = feature
            try:
                response = await client.request(
                    "SensorReadCmd",
                    {
                        "DeviceIndex": device.index,
                        "SensorIndex": index,
                        "SensorType": "Battery",
                    },
                )
                reading = response.get("SensorReading", {})
                data = reading.get("Data", [])
                if (
                    reading.get("DeviceIndex") != device.index
                    or reading.get("SensorIndex") != index
                    or reading.get("SensorType") != "Battery"
                    or not data
                ):
                    device.battery_failed = True
                    continue
                low, high = details.get("SensorRange", [[0, 100]])[0]
                value = 100 * (float(data[0]) - low) / (high - low)
                device.battery = min(100.0, max(0.0, value)) if math.isfinite(value) else None
            except CommandError:
                device.battery_failed = True
            except (ValueError, TypeError, IndexError, ZeroDivisionError):
                device.battery_failed = True

    async def _disconnect(self, client: ButtplugConnection) -> None:
        if client is self._client:
            self._ready = False
        self._operation_epoch += 1
        # A temporary server loss, phone IP change, or alternate Intiface
        # server does not negate the requested Run/Pulse. Stop any reachable
        # physical output, but keep the intention for up to 30 seconds.
        # Explicit Stop/Ogg Off/permissions changes clear intentions instead.
        await asyncio.gather(
            *(self._suspend_for_disconnect(key) for key in tuple(self.devices)),
            return_exceptions=True,
        )
        await client.close()
        if client is self._client:
            self._client = None
            self._candidate = None
            self.server_ip = self.server_url = None
            self._scan_active = False
            for device in self.devices.values():
                device.connected = False
                device.recovering = False
                device.battery = None
            self._notify()

    async def _suspend_for_disconnect(self, key: str) -> None:
        async with self._lock(key):
            device = self.devices.get(key)
            if device is None:
                return
            if self.enabled and not self._shutting_down:
                self._mark_intention_lost(key)
            await self._stop_locked(
                device, preserve_desired=self.enabled and not self._shutting_down
            )
        self._notify()

    async def _recover_native_outputs(
        self,
        client: ButtplugConnection,
        targets: list[tuple[str, int]] | None = None,
    ) -> None:
        """Stop all new physical sessions before accepting any output.

        A BLE disconnect can prevent a scheduled StopDeviceCmd from reaching
        hardware. An acknowledged stop on the new route is a hard prerequisite;
        only then may Ogg restore a still-valid, short-lived intention.
        """
        include_new_arrivals = targets is None
        if targets is None:
            targets = [
                (device.key, device.generation)
                for device in self.devices.values()
                if device.connected
            ]
        seen = set(targets)
        for key, generation in targets:
            device = self.devices.get(key)
            if device is None:
                continue
            try:
                async with self._lock(key):
                    if (
                        client is not self._client
                        or not device.connected
                        or device.generation != generation
                    ):
                        continue
                    device.recovering = True
                    # IntiHA can advertise devices that are known but whose
                    # Bluetooth session is not yet ready. That server may
                    # correctly reject StopDeviceCmd for *this* device. Keep
                    # the healthy Ogg/IntiHA WebSocket alive, and leave only
                    # this device locked until a later stop is acknowledged.
                    verified = await self._send_stop(
                        device, client, generation=generation, close_on_failure=False
                    )
                    if client is not self._client or device.generation != generation:
                        continue
                    if not client.connected:
                        raise ProtocolError("The recovery stop connection was lost")
                    if verified and device.native_maybe_active:
                        # The ordinary stop did not prove a native firmware
                        # pattern is off; never release this device's guard.
                        device.last_error = "Native stop is unavailable; check the device"
                        self.last_error = "A previous native stop could not be confirmed"
                        verified = False
                    if verified:
                        verified = await self._connection_feedback(device, client, generation)
                    if verified:
                        device.recovering = False
                        if device.last_error in {
                            "Stop could not be confirmed; check the device",
                            "Native stop is unavailable; check the device",
                        }:
                            device.last_error = None
                        if (
                            self.last_error in {
                                "A stop command could not be confirmed",
                                "A previous native stop could not be confirmed",
                            }
                            and not any(
                                item.connected and item.recovering
                                for item in self.devices.values()
                            )
                        ):
                            self.last_error = None
            finally:
                if client is self._client and device.generation == generation:
                    if self._ready and client.connected and not device.recovering:
                        self._schedule_pending_resumes(client, [(key, generation)])
                if include_new_arrivals and client is self._client:
                    # A second device may arrive while an initial recovery
                    # write is awaiting acknowledgement and hub ready is false.
                    # Include it before publishing ready, once per generation.
                    for candidate in self.devices.values():
                        target = (candidate.key, candidate.generation)
                        if (
                            candidate.connected
                            and target not in seen
                        ):
                            seen.add(target)
                            targets.append(target)
                self._notify()

    async def _connection_feedback(
        self, device: OggDevice, client: ButtplugConnection, generation: int
    ) -> bool:
        """Optional short buzz when a device (re)connects, ending in a stop.

        Runs once per connection generation, after the recovery stop and
        before any remembered Run/Pulse resumes. Returns whether the device
        is verifiably stopped afterwards (True when no feedback was sent).
        """
        if (
            self.connect_feedback != "short_pulse"
            or not device.commands_enabled
            or not device.motor_count
            or device.feedback_generation == generation
        ):
            return True
        device.feedback_generation = generation
        scalars = []
        for index, feature in device.vibration_features:
            steps = feature.get("StepCount", 100)
            steps = steps if isinstance(steps, int) and steps > 0 else 100
            level = max(1, round(CONNECT_FEEDBACK_LEVEL * steps)) / steps
            scalars.append({"Index": index, "Scalar": level, "ActuatorType": "Vibrate"})
        try:
            await client.scalar(device.index, scalars)
            await asyncio.sleep(CONNECT_FEEDBACK_SECONDS)
        except (CommandError, ProtocolError):
            pass  # The stop below is what matters.
        return await self._send_stop(
            device, client, generation=generation, close_on_failure=False
        )

    async def async_set_connect_feedback(self, value: str) -> None:
        if value not in CONNECT_FEEDBACK_OPTIONS:
            raise HomeAssistantError("Unknown connection feedback option")
        self.connect_feedback = value
        self._save_later()
        self._notify()

    def _lock(self, key: str) -> asyncio.Lock:
        return self._locks.setdefault(key, asyncio.Lock())

    def _cancel_stop_backups(self, key: str) -> None:
        """Cancel queued pulse STOPs when a new output command takes ownership.

        Call while holding the device command lock. A backup also acquires that
        lock, so it can never race a subsequent Run/Pulse/auxiliary command.
        """
        task = self._stop_backups.pop(key, None)
        if task is not None:
            task.cancel()

    def _invalidate_stop_backups(self, key: str) -> None:
        self._command_serials[key] = self._command_serials.get(key, 0) + 1
        self._cancel_stop_backups(key)

    def _schedule_pulse_stop_backups(
        self,
        device: OggDevice,
        client: ButtplugConnection,
        generation: int,
        intent: DesiredOutput,
        native_zero: bool,
    ) -> None:
        """Keep STOP redundancy outside the completed pulse runner.

        A future output invalidates the serial and cancels this task. An
        unavailable connection is instead handled by STOP-before-resume on
        the next device session; never send stale indices to a new server.
        """
        key = device.key
        if (
            self._shutting_down
            or not self.enabled
            or self._client is not client
            or not client.connected
            or not device.connected
            or device.generation != generation
            or self._command_serials.get(key, 0) != intent.command_serial
        ):
            return
        self._cancel_stop_backups(key)
        task = self.entry.async_create_background_task(
            self.hass,
            self._pulse_stop_backups(key, client, generation, intent.command_serial, native_zero),
            "ogg_pulse_stop_watchdog",
        )
        self._stop_backups[key] = task
        self._event_tasks.add(task)
        task.add_done_callback(self._event_done)

    async def _pulse_stop_backups(
        self,
        key: str,
        client: ButtplugConnection,
        generation: int,
        serial: int,
        native_zero: bool,
    ) -> None:
        """Repeat per-device STOP at +0.2, +2, +2.2, +10 and +10.2 s.

        The initial STOP is sent by the pulse runner before this task starts.
        An explicit new Run/Pulse/Stop/auxiliary output supersedes ALL pending
        backups; settings-only edits do not issue physical output commands.
        """
        began = time.monotonic()
        try:
            for delay in PULSE_STOP_BACKUP_DELAYS:
                await asyncio.sleep(max(0.0, began + delay - time.monotonic()))
                async with self._lock(key):
                    device = self.devices.get(key)
                    if (
                        device is None
                        or self._shutting_down
                        or not self.enabled
                        or client is not self._client
                        or not client.connected
                        or not device.connected
                        or device.generation != generation
                        or self._command_serials.get(key, 0) != serial
                        or device.running
                        or self._desired_outputs.get(key) is not None
                        or self._runs.get(key) is not None
                    ):
                        return
                    # A server OK is not proof that a firmware mode stopped.
                    # The duplicates therefore run even after a successful OK.
                    verified = await self._send_stop(
                        device, client, generation=generation,
                        close_on_failure=False, force_native_zero=native_zero,
                    )
                    if verified and device.last_error in {
                        "Stop could not be confirmed; check the device",
                        "Native stop could not be confirmed; check the device",
                    }:
                        device.last_error = None
                        self._notify()
        finally:
            if self._stop_backups.get(key) is asyncio.current_task():
                self._stop_backups.pop(key, None)

    def _require_device(self, key: str) -> OggDevice:
        if key not in self.devices:
            raise HomeAssistantError("This device is no longer known to Ogg")
        return self.devices[key]

    async def async_set_device_commands_enabled(self, key: str, enabled: bool) -> None:
        """Block output for one device; always permit a safety stop.

        Disabling is serialised against starts and manual commands, so a queued
        command cannot begin after the switch has been turned off.
        """
        device = self._require_device(key)
        async with self._lock(key):
            if device.commands_enabled == bool(enabled):
                return
            device.commands_enabled = bool(enabled)
            if not enabled:
                await self._stop_locked(device)
            self._save_later()
            self._notify()

    def _require_output_enabled(self, device: OggDevice) -> None:
        if not device.commands_enabled:
            raise HomeAssistantError("Commands are disabled for this device")

    def _require_online(self, device: OggDevice) -> ButtplugConnection:
        if (
            self._shutting_down
            or not self.enabled
            or not self.connected
            or not device.connected
            or device.recovering
        ):
            raise HomeAssistantError("This device is not connected to Ogg")
        self._require_output_enabled(device)
        assert self._client is not None
        return self._client

    async def async_start(self, key: str, pulse: bool = False) -> None:
        """Replace an existing run; repeated pulses restart one timer."""
        epoch = self._operation_epoch
        device = self._require_device(key)
        async with self._lock(key):
            client = self._require_online(device)
            if epoch != self._operation_epoch:
                return
            if not device.motor_count:
                raise HomeAssistantError(
                    "This device has no vibration features; use its manual controls"
                )
            await self._stop_locked(device)
            self._require_online(device)
            if epoch != self._operation_epoch:
                return
            device.last_error = None
            # The deadline starts with the original button press, not when
            # a later server or BLE session becomes available.
            deadline = time.monotonic() + self.pulse_duration if pulse else None
            intent = DesiredOutput(
                "pulse" if pulse else "continuous", deadline,
                command_serial=self._command_serials.get(key, 0),
            )
            self._desired_outputs[key] = intent
            device.running = True
            device.mode = intent.mode
            device.remaining = self.pulse_duration if pulse else None
            task = self.entry.async_create_background_task(
                self.hass,
                self._run_device(device, client, intent),
                "ogg_device_pattern",
            )
            self._runs[key] = task
            self._notify()

    async def async_stop(self, key: str) -> None:
        device = self._require_device(key)
        async with self._lock(key):
            await self._stop_locked(device)
        self._notify()

    async def _stop_locked(
        self, device: OggDevice, send_stop: bool = True, preserve_desired: bool = False
    ) -> None:
        # Revoke desired output before waiting on a task so stale completion
        # cannot re-arm it. Disconnect recovery is the sole exception.
        if not preserve_desired:
            self._desired_outputs.pop(device.key, None)
            self._invalidate_stop_backups(device.key)
        else:
            # A physical connection change invalidates the old watchdog,
            # but does not revoke the desired Run/Pulse or its deadline.
            self._cancel_stop_backups(device.key)
        generation = device.generation
        task = self._runs.pop(device.key, None)
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if send_stop and self._client is not None and self._client.connected and device.connected:
            await self._send_stop(device, self._client, generation=generation)
        device.running = False
        device.mode = "idle"
        device.remaining = None
        for key in device.aux_values:
            if key.startswith("rotate_"):
                device.aux_values[key] = 0.0

    async def _send_stop(
        self,
        device: OggDevice,
        client: ButtplugConnection,
        *,
        generation: int | None = None,
        close_on_failure: bool = True,
        force_native_zero: bool = False,
    ) -> bool:
        def current_generation() -> bool:
            return generation is None or (
                client is self._client and device.generation == generation
            )

        if not client.connected or not device.connected or not current_generation():
            return False
        try:
            native_stop_failed = False
            if (device.native_maybe_active or force_native_zero) and device.native_available:
                try:
                    await client.raw_write(
                        device.index, build_classic_packet("steady", [0.0] * device.motor_count)
                    )
                    if not current_generation() or not device.connected:
                        return False
                    device.native_maybe_active = False
                except CommandError:
                    native_stop_failed = True
            if not current_generation() or not device.connected:
                return False
            await client.stop_device(device.index)
            if not current_generation():
                return False
            if native_stop_failed:
                device.last_error = "Native stop could not be confirmed; check the device"
                self.last_error = "A native stop command could not be confirmed"
                if close_on_failure:
                    await client.close(reason="native_stop_unconfirmed")
                return False
            return True
        except ProtocolError:
            if not current_generation():
                return False
            device.last_error = "Stop could not be confirmed; check the device"
            self.last_error = "A stop command could not be confirmed"
            if close_on_failure:
                # Normal output cleanup remains fail-closed, because command
                # delivery is uncertain. During reconnect verification only,
                # keep the healthy *server* session and quarantine the device.
                await client.close(reason="stop_unconfirmed")
            return False

    async def async_all_start(self, pulse: bool = False) -> None:
        keys = [
            key
            for key, device in self.devices.items()
            if device.commands_enabled and device.connected and not device.recovering and device.motor_count
        ]
        if not keys or not self.enabled or not self.connected:
            raise HomeAssistantError("No compatible devices are connected to Ogg")
        # Start devices one after another with a small gap. A simultaneous
        # burst of stop+start commands to every device funnels through the
        # same Bluetooth proxy and made Pulse all unreliable.
        results: list[BaseException | None] = []
        for position, key in enumerate(keys):
            if position:
                await asyncio.sleep(ALL_DEVICES_STAGGER_SECONDS)
            try:
                await self.async_start(key, pulse)
                results.append(None)
            except Exception as err:  # Keep starting the remaining devices.
                results.append(err)
        if any(isinstance(result, Exception) for result in results):
            self.last_error = "Some devices could not be started"
            self._notify()
            raise HomeAssistantError(self.last_error)

    async def async_all_stop(self) -> None:
        """Cancel all local runners before the server-wide stop command."""
        self._operation_epoch += 1
        await asyncio.gather(
            *(self.async_stop(key) for key in tuple(self.devices)), return_exceptions=True
        )
        client = self._client
        if client is not None and client.connected:
            try:
                await client.stop_all()
            except ProtocolError:
                self.last_error = "All-off could not be confirmed; check the devices"
                await client.close(reason="stop_unconfirmed")
        self._notify()

    async def _run_device(
        self, device: OggDevice, client: ButtplugConnection, intent: DesiredOutput
    ) -> None:
        started = time.monotonic()
        generation = device.generation
        deadline = intent.deadline
        last_frame: tuple[Any, ...] | None = None
        last_notified = 0.0
        try:
            # The deadline also covers a slow output acknowledgement. Expiry
            # cancels that request locally and sends an explicit stop below,
            # without waiting up to the usual command timeout first.
            async with asyncio.timeout_at(deadline):
                while (
                    self.enabled
                    and client is self._client
                    and client.connected
                    and device.connected
                    and device.commands_enabled
                    and device.generation == generation
                ):
                    now = time.monotonic()
                    last_frame = await self._send_frame(device, client, now - started, last_frame)
                    now = time.monotonic()
                    device.remaining = max(0.0, deadline - now) if deadline is not None else None
                    if now - last_notified >= 0.5:
                        self._notify()
                        last_notified = now
                    await asyncio.sleep(device.message_interval)
        except TimeoutError:
            pass  # A pulse ended normally; the finally block sends the stop.
        except asyncio.CancelledError:
            raise
        except (ProtocolError, ValueError):
            device.last_error = "Output stopped because a command could not be completed"
            self.last_error = "A device command could not be completed"
        except Exception:
            device.last_error = "Output stopped after an unexpected error"
            _LOGGER.exception("Ogg stopped a device pattern after an error")
        finally:
            pulse_expired = (
                deadline is not None
                and time.monotonic() >= deadline
                and intent.lost_at is None
                and self._desired_outputs.get(device.key) is intent
                and self._runs.get(device.key) is asyncio.current_task()
                and self._command_serials.get(device.key, 0) == intent.command_serial
            )
            # Save the native profile before the first STOP clears that flag:
            # every backup must send a native zero packet too, if applicable.
            native_zero = device.engine == "native" or device.native_maybe_active
            if self._desired_outputs.get(device.key) is intent:
                if not self.enabled or self._shutting_down or not device.commands_enabled:
                    self._desired_outputs.pop(device.key, None)
                elif (
                    client is not self._client
                    or not client.connected
                    or not device.connected
                    or device.generation != generation
                ):
                    # A connection loss may be noticed by the runner before
                    # DeviceRemoved/connection-manager cleanup sees it.
                    self._mark_intention_lost(device.key)
                elif intent.lost_at is None:
                    # Pulse expired normally or an actual output failed: do
                    # not automatically retry an errored command.
                    self._desired_outputs.pop(device.key, None)
            if client is self._client and device.connected and device.generation == generation:
                await self._send_stop(
                    device, client, generation=generation, force_native_zero=native_zero
                )
            if device.generation == generation and self._runs.get(device.key) is asyncio.current_task():
                device.running = False
                device.mode = "idle"
                device.remaining = None
            if self._runs.get(device.key) is asyncio.current_task():
                self._runs.pop(device.key, None)
            if pulse_expired:
                self._schedule_pulse_stop_backups(
                    device, client, generation, intent, native_zero
                )
            self._notify()

    async def _send_frame(
        self,
        device: OggDevice,
        client: ButtplugConnection,
        elapsed: float,
        last_frame: tuple[Any, ...] | None,
    ) -> tuple[Any, ...]:
        settings = device.settings
        intensity = settings["intensity"] / 100
        pattern = settings["pattern"]
        mode = settings["motor_mode"]
        native = (
            settings["native_profile"] == "classic"
            and device.native_available
            and not device.native_failed
            and pattern in NATIVE_PATTERNS
            and mode != "alternating"
        )
        if native:
            levels = [intensity * value / 100 for value in settings["motor_levels"]]
            if mode == "motor_1":
                levels = [value if index == 0 else 0 for index, value in enumerate(levels)]
            elif mode == "motor_2":
                levels = [value if index == 1 else 0 for index, value in enumerate(levels)]
            packet = build_classic_packet(pattern, levels)
            frame = ("native", packet)
            if frame != last_frame:
                previously_active = device.native_maybe_active
                try:
                    # Remember before awaiting: cancellation may occur after
                    # bytes reached hardware but before their acknowledgement.
                    device.native_maybe_active = True
                    await client.raw_write(device.index, packet)
                    device.native_maybe_active = any(levels)
                    device.engine = "native"
                except CommandError:
                    # Only an explicit rejection is eligible for fallback. A
                    # timeout closes the link and must never replay an output.
                    device.native_failed = True
                    device.native_maybe_active = previously_active
                    device.last_error = "Native mode was rejected; using a software pattern"
                    await self._send_stop(device, client)
                else:
                    return frame
            else:
                return frame
        if last_frame is not None and last_frame[0] == "native" and not device.native_failed:
            # Leave a firmware pattern explicitly before streaming scalar data.
            await client.raw_write(
                device.index, build_classic_packet("steady", [0.0] * device.motor_count)
            )
            device.native_maybe_active = False
            await client.stop_device(device.index)
        scalars: list[dict[str, Any]] = []
        levels = []
        phase = elapsed / settings["period"]
        for ordinal, (index, feature) in enumerate(device.vibration_features):
            value = (
                intensity
                * settings["motor_levels"][ordinal]
                / 100
                * sample(pattern, phase, ordinal, mode)
            )
            steps = feature.get("StepCount", 100)
            steps = steps if isinstance(steps, int) and steps > 0 else 100
            value = math.floor(value * steps + 0.5) / steps
            levels.append(value)
            scalars.append({"Index": index, "Scalar": value, "ActuatorType": "Vibrate"})
        frame = ("software", *levels)
        if frame != last_frame:
            if not any(levels):
                await client.stop_device(device.index)
            else:
                await client.scalar(device.index, scalars)
        device.engine = "fallback" if settings["native_profile"] == "classic" else "software"
        return frame

    async def async_set_setting(self, key: str, setting: str, value: Any) -> None:
        device = self._require_device(key)
        if setting in {"intensity", "period"}:
            minimum, maximum = (0, 100) if setting == "intensity" else (0.4, 30)
            value = self._number(value, minimum, maximum)
        elif setting == "pattern":
            if value not in _PATTERNS:
                raise HomeAssistantError("Unknown pattern")
        elif setting == "motor_mode":
            if value not in MOTOR_MODES or (value != "together" and device.motor_count < 2):
                raise HomeAssistantError("This motor mode is not supported by the device")
        elif setting == "native_profile":
            if value not in {"disabled", "classic"} or (
                value == "classic" and not device.native_available
            ):
                raise HomeAssistantError(
                    "This server and device do not expose a supported native profile"
                )
            device.native_failed = False
        elif setting == "motor_levels":
            if not isinstance(value, list) or len(value) != device.motor_count:
                raise HomeAssistantError("Set one level for each supported motor")
            value = [self._number(level, 0, 100) for level in value]
        else:
            raise HomeAssistantError("Unknown device setting")
        device.settings[setting] = value
        device.revision += 1
        self._save_later()
        self._notify()

    async def async_set_pulse_duration(self, value: float) -> None:
        self.pulse_duration = self._number(value, 0.1, 300)
        self._save_later()
        self._notify()

    async def async_set_aux(self, key: str, kind: str, index: int, value: float) -> None:
        """Deliberate manual rotation/position control, only where advertised."""
        epoch = self._operation_epoch
        device = self._require_device(key)
        value = self._number(value, -100 if kind == "rotate" else 0, 100)
        count = device.rotation_count if kind == "rotate" else device.linear_count
        if kind not in {"rotate", "linear"} or not 0 <= index < count:
            raise HomeAssistantError("This device does not support that control")
        async with self._lock(key):
            client = self._require_online(device)
            if epoch != self._operation_epoch:
                return
            # Stop clears reported rotating outputs. Preserve intended values
            # first so editing one rotation motor does not erase the others.
            values = [device.aux_values.get(f"{kind}_{i}", 0) for i in range(count)]
            values[index] = value
            await self._stop_locked(device)
            self._require_online(device)
            if epoch != self._operation_epoch:
                return
            if kind == "rotate":
                command = "RotateCmd"
                payload = {
                    "DeviceIndex": device.index,
                    "Rotations": [
                        {"Index": i, "Speed": abs(level) / 100, "Clockwise": level >= 0}
                        for i, level in enumerate(values)
                    ],
                }
            else:
                command = "LinearCmd"
                payload = {
                    "DeviceIndex": device.index,
                    "Vectors": [
                        {"Index": index, "Duration": 1000, "Position": value / 100},
                    ],
                }
            try:
                response = await client.request(command, payload)
                if "Ok" not in response:
                    raise ProtocolError("Unexpected acknowledgement")
            except ProtocolError as err:
                device.last_error = "Manual command could not be completed"
                self._notify()
                raise HomeAssistantError(device.last_error) from err
            device.aux_values.update({f"{kind}_{i}": level for i, level in enumerate(values)})
            if kind == "rotate":
                device.running = any(values)
                device.mode = "continuous" if device.running else "idle"
            self._notify()

    @staticmethod
    def _number(value: Any, minimum: float, maximum: float) -> float:
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or not minimum <= value <= maximum
        ):
            raise HomeAssistantError(f"Enter a value between {minimum:g} and {maximum:g}")
        return float(value)

    @staticmethod
    def _sanitise_settings(device: OggDevice) -> None:
        settings = device.settings
        if not isinstance(settings.get("pattern"), str) or settings["pattern"] not in _PATTERNS:
            settings["pattern"] = "steady"
        if (
            not isinstance(settings.get("motor_mode"), str)
            or settings["motor_mode"] not in MOTOR_MODES
        ):
            settings["motor_mode"] = "together"
        if (
            not isinstance(settings.get("native_profile"), str)
            or settings["native_profile"] not in {"disabled", "classic"}
        ):
            settings["native_profile"] = "disabled"

    async def _cancel_monitor(self) -> None:
        task, self._monitor = self._monitor, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def async_shutdown(self) -> None:
        """Stop, disconnect, remove listeners and persist settings on unload."""
        if self._shutdown_task is None:
            self._shutdown_task = self.hass.async_create_task(self._shutdown(), "ogg_shutdown")
        # A concurrent HA stop/unload must wait for the same cleanup. If its
        # caller is cancelled, cleanup still completes and can be awaited again.
        await asyncio.shield(self._shutdown_task)

    async def _shutdown(self) -> None:
        self._shutting_down = True
        self._operation_epoch += 1
        if self._unsubscribe_ips is not None:
            self._unsubscribe_ips()
            self._unsubscribe_ips = None
        await self.async_all_stop()
        await self._cancel_monitor()
        if self._client is not None:
            await self._disconnect(self._client)
        for task in tuple(self._event_tasks):
            task.cancel()
        self._stop_backups.clear()
        await asyncio.gather(*self._event_tasks, return_exceptions=True)
        self._event_tasks.clear()
        await self._store.async_save(self._saved_data())
        self._notify()
