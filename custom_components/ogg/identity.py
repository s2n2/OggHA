"""Match logical devices independently of their current server location.

V3 identifies routes with a server-local index, but does not supply a portable
physical identifier. Match unambiguous model/display names across servers and
use old route bindings only to distinguish identical entries already known on
one server. Never assign two rows in a snapshot to one logical device.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from .models import OggDevice, device_key, identity_parts, legacy_device_key, physical_address


def _parts(device: OggDevice) -> tuple[str, str]:
    return identity_parts(device.raw)[0], device.identity_display_name


def new_device_key(devices: dict[str, OggDevice], source: str, raw: dict[str, Any]) -> str:
    """Allocate a persistent key without merging two simultaneous instances."""
    base = device_key(source, raw)
    key = base
    suffix = 2
    while key in devices:
        key = f"{base}_{suffix}"
        suffix += 1
    return key


def match_device(
    devices: dict[str, OggDevice],
    source: str,
    raw: dict[str, Any],
    claimed: set[str],
    current_raws: list[dict[str, Any]],
) -> OggDevice | None:
    """Find one unambiguous existing identity, without mutating any record."""
    mac = physical_address(raw)
    available_all = [device for device in devices.values() if device.key not in claimed]
    if mac:
        exact_mac = [device for device in available_all if physical_address(device.raw) == mac]
        if len(exact_mac) == 1:
            return exact_mac[0]
        if len(exact_mac) > 1:
            # Ambiguous duplicate records: never guess which one to control.
            return None
        # Upgrade an earlier name-only identity in place when its own route
        # is still known. This preserves its HA entity IDs and user settings.
        old_route = [device for device in available_all
                     if not physical_address(device.raw)
                     and device.bindings.get(source) == raw.get("DeviceIndex")]
        if len(old_route) == 1:
            return old_route[0]
    model, label = identity_parts(raw)
    if not model:
        return None
    same_model = [device for device in available_all if _parts(device)[0] == model
                  and (not mac or not physical_address(device.raw))]
    available = same_model
    exact = [device for device in available if device.identity_display_name == label]
    # A remembered route is only a tiebreaker among matching identities. It
    # never turns a different model or explicit display name into this device.
    bound = [device for device in exact if device.bindings.get(source) == raw.get("DeviceIndex")]
    if len(bound) == 1:
        return bound[0]
    rows = [item for item in current_raws if identity_parts(item)[0] == model]
    same_identity_rows = [item for item in rows if identity_parts(item)[1] == label]
    if len(exact) == 1 and len(same_identity_rows) == 1:
        return exact[0]
    # One server may omit a custom display name. Accept that difference only
    # when there is exactly one instance of the model on both sides. Retaining
    # identity_display_name prevents this hop from forgetting a named identity.
    if len(same_model) == 1 and len(available) == 1 and len(rows) == 1:
        previous = available[0].identity_display_name
        if not label or not previous:
            return available[0]
    return None


def _can_coalesce(devices: list[OggDevice]) -> bool:
    """Multiple distinct indices on one source are evidence of separate units."""
    routes: dict[str, set[int]] = defaultdict(set)
    for device in devices:
        for source, index in device.bindings.items():
            routes[source].add(index)
    return all(len(indices) <= 1 for indices in routes.values())


def _merge_group(
    group: list[OggDevice],
    output: dict[str, OggDevice],
    aliases: dict[str, str],
    *,
    same_mac: bool = False,
) -> None:
    """Keep the original key/settings and merge only unambiguous duplicates.

    One explicit physical MAC outweighs stale historical DeviceIndex values.
    An index can change between sessions, even for the same server source.
    """
    if not same_mac and not _can_coalesce(group):
        output.update((device.key, device) for device in group)
        return
    primary = group[0]
    for duplicate in group[1:]:
        primary.bindings.update(duplicate.bindings)
        if not primary.identity_display_name:
            primary.identity_display_name = duplicate.identity_display_name
        # Preserve settings for any extra motors only the later server showed;
        # existing canonical values always win when both copies define them.
        memory = duplicate.stored()["motor_level_memory"]
        primary.motor_level_memory.extend(memory[len(primary.motor_level_memory) :])
        aliases[duplicate.key] = primary.key
    output[primary.key] = primary


def load_devices(records: Any) -> tuple[dict[str, OggDevice], dict[str, str]]:
    """Load saved devices and report old duplicate keys to consolidate in HA.

    Existing canonical keys are immutable. Legacy key reconstruction is only
    needed for old/partial records without a stored key. Settings from the
    earliest record win, so switching servers cannot replace them with defaults.
    Ambiguous same-model copies remain separate until users distinguish them
    with consistent unique display names.
    """
    if not isinstance(records, list):
        return {}, {}
    groups: dict[str, list[OggDevice]] = defaultdict(list)
    seen: set[str] = set()
    for record in records:
        if not isinstance(record, dict):
            continue
        source = record.get("source")
        raw = record.get("raw")
        if not isinstance(source, str) or not isinstance(raw, dict):
            continue
        index = raw.get("DeviceIndex")
        if (
            not isinstance(raw.get("DeviceMessages"), dict)
            or not isinstance(index, int)
            or isinstance(index, bool)
            or index < 0
            or not identity_parts(raw)[0]
        ):
            continue
        key = record.get("key")
        if not isinstance(key, str) or not key:
            key = legacy_device_key(source, raw)
        if key in seen:
            continue
        settings = record.get("settings")
        device = OggDevice(
            key=key,
            alias=str(raw.get("DeviceDisplayName") or raw["DeviceName"]),
            source=source,
            raw=raw,
            settings=settings if isinstance(settings, dict) else {},
            commands_enabled=record.get("commands_enabled", True) is not False,
            bindings=record.get("bindings", {}),
            identity_display_name=record.get("identity_display_name", ""),
            motor_level_memory=record.get("motor_level_memory", []),
        )
        seen.add(key)
        mac = physical_address(device.raw)
        groups[f"mac:{mac}" if mac else f"model:{_parts(device)[0]}"].append(device)
    output: dict[str, OggDevice] = {}
    aliases: dict[str, str] = {}
    for group in groups.values():
        addresses = {physical_address(device.raw) for device in group if physical_address(device.raw)}
        if len(addresses) == 1 and all(physical_address(d.raw) for d in group):
            _merge_group(group, output, aliases, same_mac=True)
            continue
        labels = {device.identity_display_name for device in group if device.identity_display_name}
        if len(labels) <= 1 and _can_coalesce(group):
            _merge_group(group, output, aliases)
        else:
            # Different explicit labels always represent different identities.
            # An unnamed record cannot pick between multiple named identities.
            by_label: dict[str, list[OggDevice]] = defaultdict(list)
            for device in group:
                by_label[device.identity_display_name].append(device)
            for labelled_group in by_label.values():
                _merge_group(labelled_group, output, aliases)
    return output, aliases
