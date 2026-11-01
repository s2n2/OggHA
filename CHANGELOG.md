# Changelog

## 0.1.1

- Keep each device's Home Assistant identity when it moves to another server,
  IP address, configured address source or server-local device index.
- Preserve original device names, entity IDs and settings while routing commands
  to the current connection. Different advertised motor counts no longer create
  another device; temporarily unavailable motor settings are retained.
- Consolidate unambiguous duplicates saved by Ogg 0.1.0, retaining the first
  saved device and its settings. Remove redundant registry entries before
  loading entities. References to removed duplicate entities may need updating.
- Keep same-model devices with distinct, consistent server display names
  separate. Leave ambiguous identical devices separate rather than guessing.
- Add real Home Assistant regressions for cross-IP failover, changed indices,
  sensor-to-manual source changes, reloads, capability changes and upgrade
  migration. Discovery and reconnection continue without starting motors.

## 0.1.0

Initial Ogg release, rebuilt as a separate Home Assistant integration.

- Offline-friendly setup with connection and address sensors.
- Five fixed server addresses and five sensor-supplied addresses.
- Background discovery, reconnect and failover.
- Master enable, per-device run, timed pulse and grouped controls.
- Software patterns with intensity, cycle period and motor controls.
- Explicitly selected native patterns for supported classic We-Vibe models.
- Original device names, retained settings and redacted diagnostics.
- HACS repository structure, regression tests and validation workflows.

Physical-device acceptance testing is required before treating a release as
hardware-validated. The protocol and Home Assistant tests use simulated servers.
