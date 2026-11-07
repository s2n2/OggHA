## 0.1.6 - server-agnostic recovery, identity and intensity
- Retain non-persistent desired Run/Pulse state during short (30-second maximum) disconnects, across different Intiface servers. Confirm STOP on the new session before resuming.
- Never extend pulse deadlines: only the remaining time is eligible for resumption. Explicit Stop, permission disable, Ogg Off, or expiry cancels the intent.
- Match Bluetooth devices by explicit MAC when the server supplies one, preserving entity identities/settings across changed server names and indices. Keep distinct MAC addresses separate.
- Add a device **Intensity** dropdown to the HACS-bundled Control Deck, displaying the current percentage and 10% increments (0% through 100%). Retain the current percentage if not on a 10% step.
- Fix first-use device Pulse actions; update the frontend resource version so browsers fetch the new card.

- Fix first-use per-device Pulse buttons in Control Deck when Home Assistant reports an unpressed button as `unknown`.
- On every new Ogg device session, cancel old runners, reset pulse/run state, issue a stop, and only permit new commands once recovery completes.
- Retain the HACS dashboard resource and settings shortcuts.

# Changelog

## 0.1.4

- Add settings gear links next to HA Server and Ogg in the Control Deck, opening the corresponding Home Assistant integration pages.
- Keep on/off controls independent; use in-app navigation on ordinary clicks with native browser fallback for modified clicks.
- Refresh the versioned Lovelace resource so HACS updates the bundled card.

## 0.1.3

- Bundle the mobile-first **Ogg Control Deck** dashboard card directly in the
  HACS Ogg integration. No separate dashboard plugin or `/config/www` copy.
- Serve the card from `/ogg/control-deck/ogg-control-deck-card.js` and
  automatically register a versioned Lovelace module in storage-mode dashboards.
- Register the card once per Ogg integration, not once per configured server,
  and update its resource URL on future releases without duplicating it.
- Load existing Lovelace resources before modifying them so unrelated
  dashboard cards are preserved.
- In YAML resource mode, expose the URL but leave resource configuration to
  the administrator. Frontend errors cannot prevent Ogg's engine loading.

## 0.1.2

- Add a persistent **Connect this device** switch to each known device. When off, regular output commands are blocked and any active output is stopped. Discovery and connection monitoring continue.
- Exclude disabled devices from global Run and Pulse all actions. Explicit Stop controls remain available for safety; a server-wide emergency stop may reach disabled devices.
- Add **Pulse duration (all devices)** to every device's entity page. All copies share the existing global pulse timer and update together. The original timer remains on the Ogg controller.
- Preserve existing device identity, aliases, and settings; default existing devices to allowed.


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
