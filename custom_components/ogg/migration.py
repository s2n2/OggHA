"""Consolidate the registry records created by old server-scoped identities."""

from __future__ import annotations

from collections.abc import Mapping

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN


def _device_for_key(
    registry: dr.DeviceRegistry, entry_id: str, key: str
) -> dr.DeviceEntry | None:
    """Use the entry-scoped API shared by supported Home Assistant versions."""
    identifier = (DOMAIN, f"{entry_id}:{key}")
    hub_identifier = (DOMAIN, entry_id)
    return next(
        (
            device
            for device in dr.async_entries_for_config_entry(registry, entry_id)
            if identifier in device.identifiers and hub_identifier not in device.identifiers
        ),
        None,
    )


def _config_entry_ids(device: dr.DeviceEntry) -> set[str]:
    """Support both the former shared registry and current single-owner records."""
    if (entry_id := getattr(device, "config_entry_id", None)) is not None:
        return {entry_id}
    return set(device.config_entries)


def _canonical_key(aliases: dict[str, str], key: str) -> str | None:
    """Resolve chained aliases without applying malformed cycles to the registry."""
    visited: set[str] = set()
    while key in aliases:
        if not key or key in visited:
            return None
        visited.add(key)
        key = aliases[key]
    return key or None


def _has_dependents(registry: dr.DeviceRegistry, device_id: str) -> bool:
    """Avoid cascading removal or link changes into unrelated registry devices."""
    registered = registry.devices
    entries = registered.values() if isinstance(registered, Mapping) else registered
    if any(device.via_device_id == device_id for device in entries):
        return True
    children_for_parent = getattr(dr, "async_entries_for_parent_device", None)
    return bool(children_for_parent and children_for_parent(registry, device_id))


def _copy_user_metadata(
    registry: dr.DeviceRegistry, source: dr.DeviceEntry, target: dr.DeviceEntry
) -> None:
    """Keep the original device's choices; fill only previously unset fields."""
    changes = {
        field: getattr(source, field)
        for field in ("name_by_user", "area_id")
        if getattr(target, field) is None and getattr(source, field) is not None
    }
    if changes:
        registry.async_update_device(target.id, **changes)


async def async_migrate_device_registry(
    hass: HomeAssistant, entry: ConfigEntry, aliases: dict[str, str]
) -> None:
    """Apply only identity matches already established by the stored-device migration.

    The first device key and its entity IDs remain canonical. Additional capabilities
    keep their existing entity IDs when moved. Redundant entities are removed; Home
    Assistant cannot redirect automations referencing those redundant entity IDs.
    Run before platforms load, so registry changes cannot race active Ogg entities.
    """
    if not aliases:
        return
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    entry_id = entry.entry_id

    for old_key in aliases:
        canonical_key = _canonical_key(aliases, old_key)
        if not old_key or canonical_key is None or canonical_key == old_key:
            continue
        old_identifier = (DOMAIN, f"{entry_id}:{old_key}")
        canonical_identifier = (DOMAIN, f"{entry_id}:{canonical_key}")
        source = _device_for_key(devices, entry_id, old_key)
        target = _device_for_key(devices, entry_id, canonical_key)

        if source is not None and target is None:
            source_entities = er.async_entries_for_device(
                entities, source.id, include_disabled_entities=True
            )
            exclusively_owned = _config_entry_ids(source) == {entry_id} and all(
                entity.config_entry_id == entry_id and entity.platform == DOMAIN
                for entity in source_entities
            )
            if exclusively_owned and source.identifiers == {old_identifier}:
                # A partially populated registry may only contain the later copy.
                # Reuse it, retaining its device ID and all user configuration.
                target = devices.async_update_device(
                    source.id, new_identifiers={canonical_identifier}
                )
            else:
                target = devices.async_get_or_create(
                    config_entry_id=entry_id,
                    identifiers={canonical_identifier},
                    name=source.name,
                    manufacturer=source.manufacturer,
                    model=source.model,
                )

        if source is not None and target is not None and source.id != target.id:
            _copy_user_metadata(devices, source, target)

        old_prefix = f"{entry_id}:{old_key}:"
        canonical_prefix = f"{entry_id}:{canonical_key}:"
        for entity in er.async_entries_for_config_entry(entities, entry_id):
            if entity.platform != DOMAIN or not entity.unique_id.startswith(old_prefix):
                continue
            unique_id = canonical_prefix + entity.unique_id[len(old_prefix) :]
            existing_id = entities.async_get_entity_id(entity.domain, DOMAIN, unique_id)
            if existing_id is not None:
                existing = entities.async_get(existing_id)
                if existing is None or existing.config_entry_id != entry_id:
                    # A foreign record is never safe to overwrite or delete.
                    continue
                if target is not None and existing.device_id != target.id:
                    entities.async_update_entity(existing_id, device_id=target.id)
                entities.async_remove(entity.entity_id)
            elif target is not None:
                entities.async_update_entity(
                    entity.entity_id, new_unique_id=unique_id, device_id=target.id
                )
            else:
                # Preserve orphan entities too; the platform will attach the device.
                entities.async_update_entity(entity.entity_id, new_unique_id=unique_id)

        if source is None or target is None:
            continue
        if source.id == target.id:
            # A prior run may have already put both identifiers on one device.
            current = devices.async_get(source.id)
            if current is not None and old_identifier in current.identifiers:
                devices.async_update_device(
                    source.id, new_identifiers=current.identifiers - {old_identifier}
                )
            continue

        remaining = er.async_entries_for_device(
            entities, source.id, include_disabled_entities=True
        )
        if any(entity.config_entry_id == entry_id for entity in remaining):
            # Removing membership also removes this entry's remaining entities,
            # including other platforms and unresolved unique-ID conflicts.
            continue
        if _config_entry_ids(source) != {entry_id}:
            # On older HA versions one device may be shared with other integrations.
            # Detach only this entry and its exact identifier, never their entities.
            devices.async_update_device(
                source.id,
                new_identifiers=source.identifiers - {old_identifier},
                remove_config_entry_id=entry_id,
            )
        elif (
            not remaining
            and source.identifiers == {old_identifier}
            and not _has_dependents(devices, source.id)
        ):
            devices.async_remove_device(source.id)
