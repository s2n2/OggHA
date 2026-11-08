## 1.1.0b2 - Two servers at once (beta)
- Servers are now told apart by the name they report when connecting: the local **IntiHA** server always takes the "house" slot and any other server (for example your phone's Intiface app) the second slot, whatever order the addresses are listed in. The same phone reachable at two addresses (VPN and Wi-Fi) is only connected once.

## 1.1.0b1 - Two servers at once (beta)
- New option **Connect to two servers at once (beta)** in Ogg's settings (off by default). Ogg keeps the first configured address (normally this Home Assistant's IntiHA) and one other reachable address (for example your phone running Intiface) connected together, so house devices and phone devices can be played simultaneously.
- Devices from both servers appear as one list; which server a device is on is invisible. Commands are routed to the device's own server automatically.
- If one server drops, only its devices go offline and that server is retried in the background; Ogg only reports disconnected when no server is reachable. Search starts and stops scanning on both servers.
- IntiHA's Bluetooth-address identity is read from each connected server, so the same toy stays one device.
- With the option off, behaviour is unchanged from 1.0.0 (one server at a time, failing over between addresses).

## 1.0.0 - First stable release
- **Hold to run:** every device has a hold button (two-motor devices: Hold 1 and Hold 2, one per motor). It runs the device's pattern while held and stops on release; if the card stops refreshing (released, closed, connection lost) the output stops by itself within about a second. New `ogg.hold` service.
- **Search** is now a toggle (switch "Search for devices") using the standard Buttplug StartScanning/StopScanning. Ogg no longer scans continuously; a search stops when the server reports it finished, when switched off, or after 5 minutes. The card's Search pill shows the toggle.
- **His / hers:** each device has an Owner setting (Unassigned/His/Hers) with a small chip on the card; the device list can be filtered All/His/Hers, and Pulse all / Stop all then act on the shown devices only.
- The separate Pulse in / Pulse out buttons were removed (single Pulse button again); old entities are cleaned up automatically.
- Includes everything since 0.1.13: device identity and duplicate cleanup, connection feedback, two-motor patterns, Random mode, compact server tiles and the two-line sparkline.

## 0.1.19 - Two-motor control
- **Two-motor devices** (e.g. Sync 2) now use a full two-motor pattern set instead of the single-motor list: Steady/Pulse/Wave (both), Ping-pong, Chase, Counter wave, Breath (offset), Heartbeat and Double pulse (in, then out), Echo bounce, Ramp swap, Steps cross, Tease pulse, Rumble pulse and Surge layer, plus Random. Saved single-motor patterns switch to Steady (both).
- **Pulse in / Pulse out** buttons (new entities) pulse just the inner or outer motor; the card shows **In / Out / Both** instead of a single Pulse button for two-motor devices. Random on two-motor devices uses the two-motor set and steps the motors out of phase.
- **Card:** two-motor devices show both motors in the sparkline (teal = in, violet = out). Server tiles show the real state (Disabled, Connected, Connected · searching, Engine offline, Searching, Reconnecting, …). A **Search** button under the connected count starts a device search on whichever server Ogg is connected to. The Motors selector is replaced by the In/Out/Both buttons.

## 0.1.17 - Two-motor patterns, Random mode
- **Two-motor patterns** (shown only for two-motor devices such as Sync 2): Ping-pong, Chase, Counter wave, Tease pulse and Rumble pulse, each driving the two motors differently.
- **Random mode** for every device: intensity sets how often it runs (about intensity squared: 100% almost continuously with brief silent gaps, 50% about a quarter of the time, 10% about 1%). Each burst has a random pattern or step sequence (including silent steps), speed, cycle time and length; two-motor devices also get random motor combinations.
- **Card:** a **Motors** selector (Together / Alternating / Motor 1 only / Motor 2 only) appears for two-motor devices. In Random mode the card shows **How often** instead of Intensity and hides Cycle time. Status colour fix for the server tiles.

## 0.1.16 - Compact server tiles
- HA Server and Ogg tiles are a single compact row (about half the previous height).
- Status reads **Connected** when Ogg is connected to a server (otherwise "Looking for server"), and for IntiHA when its engine is connected ("Searching…" while a scan runs, "Waiting for engine" otherwise).
- IntiHA's tile shows a **Search devices** button while IntiHA is on and connected to its engine.

## 0.1.15 - Duplicate cleanup
- On load, a device identified by Bluetooth address absorbs older name-only records of the same model; the oldest record keeps its entity IDs and settings and takes the current route. Different explicit display names are never merged.
- Offline Ogg devices can now be deleted from their Home Assistant device page (live devices and the Ogg hub cannot).

## 0.1.14 - Connection feedback and IntiHA identity
- New **Connection feedback** setting (Silent / Short pulse). With Short pulse, a device that connects or reconnects gives one 0.2 s buzz at 30%, followed by the usual stop and resume. Default is Silent.
- Ogg reads Bluetooth addresses from IntiHA (`/intiha/devices`) so the same toy is one device across reconnects and servers.
- Pulse all and Run all start devices one after another with a short gap instead of in one burst.
## 0.1.13 - Compact server controls
- HA Server and Ogg return to one horizontal pair of compact tiles at mobile dashboard widths.
- Each tile keeps its own settings gear, On/Off state and toggle on two tidy internal lines, avoiding overlapping switches and the 2x vertical height of v0.1.12.
- No backend, pulse STOP watchdog or sensor changes; existing dashboard resources update to a new cached version.

## v0.1.12 — Card layout and feedback clarity

- Server settings and switches now appear in independent full-width rows until the card has room for two wide tiles, avoiding collisions in section views.
- Device names can occupy two lines, with the target/feedback sparkline to the right and the Allowed badge underneath.
- A footer version marker helps identify stale browser-cached card resources.
- Refresh the bundled resource during Ogg integration reload as well as Home Assistant startup.
- No changes to Ogg pulse timing, STOP safety net or physical motor commands.

## 0.1.12 - Responsive Control Deck layout fix
- Prevent HA Server/Ogg switches and settings links colliding inside narrow dashboard columns.
- Lay out server tiles with controls on their own lower row when the card is narrow, then restore a horizontal layout in wider cards.
- Use CSS container queries so the mobile layout responds to the actual dashboard card width, even when Home Assistant is open in a desktop browser or a narrow grid section.
- Preserve the v0.1.10 dual intensity traces, v0.1.8 repeated pulse STOP watchdog, and all existing control entities and service calls.
- Bump the auto-registered Lovelace resource URL to refresh cached JavaScript after HACS update.

## 0.1.10 - Target versus device-reported waveform
- Show two independent tracks in the Ogg Control Deck: a dim dashed **target** pattern and a brighter solid **device-reported** level from IntiHA b19, when the sensor is available.
- Discover feedback sensors by a unique match to the Home Assistant device name, or map manually via `reported_intensity_entities` when aliases differ. Never assume two devices are the same just because both say We-Vibe.
- Missing, stale, or disconnected feedback stays blank (never faked as measured zero); the target preview still works on other servers and unsupported devices.
- Keep the card frontend-only, preserve the pulse STOP safety-net and all server/device controls. The external Buttplug protocol is unchanged.

## 0.1.9 - Animated per-device pattern sparklines
- Add a small, scrolling intensity waveform beside each connected device name in the bundled Ogg Control Deck, optimised for narrow mobile screens.
- Preview the selected software pattern at the configured cycle period and intensity, including a baseline and stop decay; native firmware output remains an approximation, not motor telemetry.
- Keep the graphs frontend-only: no new Home Assistant entities, high-frequency state history, WebSocket protocol extensions, or changes to the tested pulse/STOP watchdog.
- Share one lightweight ticker across visible devices, pause when hidden or disconnected, and stop redrawing when every history trace is flat.
- Refresh the bundled Lovelace resource to v0.1.9. All existing controls and device settings are preserved.

## 0.1.8 - Redundant pulse STOP watchdog
- Add a STOP safety net for every completed individual or all-device pulse: initial STOP, then five repeated STOP attempts at approximately +0.2, +2, +2.2, +10 and +10.2 seconds (measured from the first STOP completion).
- Repeat the native We-Vibe zero-output packet as well as the standard StopDeviceCmd for each backup if a native firmware pattern was active. A server acknowledgement alone does not cancel the backups.
- Every backup is bound to the original device generation, server session and command serial. New Run, Pulse, Stop, manual output or disabling Ogg cancels its older backups, so they cannot interrupt new activity. Disconnection discards the old-session watchdog; existing reconnect verification requires STOP before output resumes.
- Backup attempts run in background and use a per-device lock; dashboard controls remain responsive. An unreachable device cannot be stopped over a disconnected Bluetooth link, so this remains a best-effort safety net, not a hardware guarantee.
- No IntiHA change needed. Existing device names, server failover and HACS Control Deck remain unchanged.

## 0.1.7 - IntiHA connection recovery hotfix
- Keep the server WebSocket connected if one known Bluetooth device refuses a STOP while its connection is not yet ready. Only that device stays quarantined (`recovering`) until an acknowledged STOP succeeds.
- Retry failed device recovery on subsequent device-list refreshes, without losing the server, other connected devices, device settings, or the 30-second Ogg-owned Run/Pulse intention.
- Preserve strict STOP-before-resume. A device without an acknowledged STOP remains unavailable for output. Normal output-stop failures still close a potentially unsafe session.
- Report handshake errors separately from per-device recovery failures, and clear stale recovery warnings once all connected devices are verified.
- Refresh the bundled HACS dashboard-card resource version. No IntiHA engine update is necessary for this Ogg hotfix.

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
