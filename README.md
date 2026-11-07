### Compact control deck (0.1.13)
HA Server and Ogg now share a **single compact row** again on narrow dashboards. Each control keeps its settings link, status and switch, without overlap.

### Control Deck layout (0.1.12)

The bundled Ogg Control Deck automatically adapts to **card width**, not browser size. On narrow Home Assistant dashboard columns, server toggles and settings gears use a second row within their tile to prevent overlap. No YAML or entity changes are needed. The existing dual-trace waveform, pulse STOP retries and other functionality are unchanged.

# Ogg

**Local control. Clear status. Your devices, under their own names.**

Ogg is a Home Assistant integration for devices connected to an Intiface or
compatible Buttplug server. The integration is named **Ogg** throughout Home
Assistant. Individual devices retain the name supplied by the server.

Ogg loads even when every configured server is offline. Its connection switch,
status sensors and settings remain available while it searches or reconnects.
An offline server is a connection state, rather than a failed integration setup.

## What you get

| Control | What it does |
| --- | --- |
| **Enabled** | Connects and searches when on. Stops devices and disconnects when off. |
| **All devices** | Starts connected vibration-capable devices with their individual settings. Turning it off stops them. |
| **Pulse all** | Runs each connected vibration-capable device for the shared pulse duration. |
| **Stop all** | Stops Ogg activity and sends the server's stop-all command. |
| **Search now** | Starts another connection or device-discovery attempt. |
| **Pulse duration** | Sets the duration used by every device's Pulse button and Pulse all. |
| **Connection status / Server IP / Connected devices** | Shows the live connection and discovery state. |
| **Run / Pulse / Stop, per device** | Continuous activity, a timed burst, or an immediate stop request. |
| **Intensity / Pattern / Cycle period** | Adjusts the level, envelope and software cycle length for each device. |
| **Motor mode and motor levels** | Controls multiple vibration motors together, alternately or individually when available. |
| **Native protocol** | Enables the guarded classic We-Vibe path when the server and exact model qualify. |
| **Rotation / Position** | Retains manual controls for advertised rotary or linear features. These are separate from vibration patterns. |

Ogg sends no motor-start commands during discovery. A brief disconnect can
preserve a **transient desired Run/Pulse intention for up to 30 seconds**.
On reconnection Ogg first requests an acknowledged STOP on the new server,
then resumes continuous Run or only the remaining pulse duration. A Stop,
command-permission disable, Ogg Off, long outage, pulse expiry or restart
cancels the intention. No intention is saved to persistent storage.

## Install with HACS

Requires Home Assistant **2025.10 or later**, HACS, and a reachable Intiface or
compatible server supporting the Buttplug v3 client protocol. Ogg uses Home
Assistant's existing networking dependencies; it does not install the old
`buttplug-py` package.

1. In **HACS**, open the three-dot menu and select **Custom repositories**.
2. Add `https://github.com/s2n2/OggHA` with category **Integration**.
3. Download **Ogg**, then restart Home Assistant.
4. Open **Settings → Devices & services → Add integration**, then search for **Ogg**.
5. Enter your server addresses and/or choose the sensors that report them.
6. Turn on **Ogg Enabled**. Turn on the server and put devices into their normal
   connection/discovery mode. They appear as Home Assistant devices.

This repository supports installation as a HACS custom repository. It is not a
claim of inclusion in the HACS default catalogue.

### Ogg Control Deck: bundled dashboard card (v0.1.9+)

The gear beside **HA Server** opens IntiHA in Devices & services, and the gear beside **Ogg** opens Ogg in Devices & services. These links are separate from the on/off switches.


**Ogg Control Deck is included in the Ogg HACS integration.** It uses Ogg's
existing entities and the IntiHA server switch; no separate HACS Dashboard
plugin, Node build or copying a JavaScript file into `/config/www` is required.

1. Update **Ogg** in HACS to v0.1.9 or newer and **restart Home Assistant** so
   the newly bundled Python code and dashboard HTTP route are loaded.
2. In **Settings → Dashboards → Resources**, confirm that the JavaScript module
   `/ogg/control-deck/ogg-control-deck-card.js?v=0.1.9` is listed. Ogg adds
   or updates that resource automatically in the normal (storage) mode.
3. Edit any dashboard → **Add card** → **Manual** (or select *Ogg Control Deck*
   from the card picker if shown), and enter:

   ```yaml
   type: custom:ogg-control-deck-card
   title: Control deck
   ```

4. Save the dashboard, then refresh the browser or companion app.

The card shows **HA Server**, **Ogg**, a shared pulse timer, **Pulse all**,
**Stop all** and controls for *currently connected* Ogg devices only. Each
connected device has Run, Pulse, Stop, Connect this device (command permission),
Pattern, Cycle time (1, 2, 3, 5, 10, 15 or 30 seconds), and Intensity
(0% to 100% in 10% increments). It also displays a non-step current
intensity, such as 25%, until changed. It automatically respects renamed
devices. Reconnection can restore a still-valid Ogg-owned Run/Pulse intention
after an acknowledged STOP; the card itself never starts a device by itself.

Each connected device also shows a **tiny animated intensity graph beside its name**.
It tracks the selected software pattern, cycle time, intensity and Run/Pulse state,
with a rolling ~8-second history. The graph is a **visualisation of the requested
pattern**, not a live reading from the hardware. Classic/native firmware patterns
are approximate because those patterns run inside the device. When output stops,
the graph returns to zero. The lightweight animation pauses when the card is not
visible and avoids generating Home Assistant history entries.

[See the updated mobile preview](docs/assets/ogg-control-deck-mobile-sparkline.png).

**If you installed the previous standalone card:** remove its old
`/local/ogg-control-deck-card.js` entry from Dashboard Resources, otherwise
Home Assistant might load the older script first. The new resource replaces it;
there is no need to remove your existing dashboard card YAML.

**If you manage Lovelace resources in YAML mode**, Ogg cannot modify that
configuration. Add this resource manually to your Lovelace resources:

```yaml
resources:
  - url: /ogg/control-deck/ogg-control-deck-card.js?v=0.1.9
    type: module
```

This only registers the card, it does not automatically place it on every
dashboard. If the resource isn't visible after the HACS update, check that
Home Assistant has restarted, then hard-refresh your browser.


For manual installation, copy `custom_components/ogg` into your Home Assistant
configuration's `custom_components` folder, restart, then add Ogg as above.

## Configure your servers

You can enter **five manual addresses** and select **five sensor entities**.
Manual values can be IP addresses, hostnames, `host:port`, or full `ws://` / `wss://`
URLs. A plain address uses the configured port, normally `12345`, and TLS setting.
An explicit URL supplies its own scheme and port.

Examples:

```text
192.168.1.40
192.168.1.41:12345
ws://192.168.1.42:12345
wss://ogg-server.example:12345
```

For a phone whose address changes, select its Home Assistant IP-address sensor.
Ogg reads that sensor's **state**, not the phone's location or a guessed network
attribute. The value must contain a valid address. `unknown` and `unavailable`
values are skipped until the sensor updates. If your address lives in an entity
attribute, expose it as a template sensor first.

Ogg connects to **one server at a time**. The configured addresses are alternatives,
not ten simultaneously controlled servers. Duplicate addresses are tried once.
If the active server disappears, Ogg cycles through the available candidates
and keeps retrying. Changes to a selected IP sensor trigger a fresh check.
It searches the configured addresses only; it does not scan your whole subnet.

Edit addresses, sensors, port, TLS and retry interval through **Configure** on the
Ogg integration. A configuration change reloads Ogg and stops current activity.

### Server setup

Start the server on the computer or phone that is in Bluetooth range of the
devices. Allow connections from Home Assistant on your local network. A server
bound only to `localhost` will not be reachable from a different machine.

Close another application that has taken exclusive control of the devices if
discovery fails. The address sensor tells Ogg where the phone is; it does not
start the server app or keep a phone app awake.

## Everyday controls

Choose a device's intensity and pattern, then use **Run** for continuous operation
or **Pulse** for a timed burst. The pulse duration limits the entire burst, including
any repeated pattern cycles within it. A second Pulse press starts a fresh timed
burst rather than leaving multiple independent timers running.

**All devices** and **Pulse all** use each device's own settings. They do not
overwrite individual intensity, pattern or motor choices. An intensity of zero
is off. Changing a setting while a device is idle prepares its next run.

**Cycle period** is the length of a software-generated cycle in seconds. A lower
value makes the pattern faster. When a native pattern is in use, the device owns
its timing and this setting does not alter its firmware timing.

See [the example dashboard](examples/dashboard.yaml) for a panel made entirely
from built-in Home Assistant cards. Check your actual entity IDs before using
the example; names and previous registry entries can affect them.

## Patterns and We-Vibe support

Ogg includes steady, pulse, wave, breath, ramp, heartbeat, double pulse, steps,
echo and surge software envelopes, plus software interpretations of the native
pattern names. Software patterns use only the vibration features advertised by
the server. They work with single and multiple motors where supported.

Some classic We-Vibe server drivers leave both motor-enable bits set when one
motor is assigned zero. In that combination, **Motor 1 only**, **Motor 2 only**
or an alternating pattern can leave the other motor at its minimum rather than
fully off. Ogg cannot repair that hardware-driver behaviour through standard
scalar commands. The guarded native path controls the bits explicitly when it
is available. **Stop** and **Stop all** stop the whole device.

**Native We-Vibe patterns are conditional.** The classic protocol documents
firmware pattern IDs, but that does not mean every We-Vibe model or every current
server exposes a usable native-pattern command.

Ogg exposes **Native protocol → Classic We-Vibe** only when an exact recognised
classic model has the expected motor resolution and the server advertises a
raw-write `tx` endpoint. You must explicitly select that profile. Newer families,
including Moxie, Vector and Chorus, use different protocols and use Ogg's software
patterns here. Current upstream servers may remove raw access even for a v3
client, so the native selector may be absent on a recent Intiface installation.

The **Pattern engine** sensor shows the path actually in use. Native rejection
falls back to software when the connection remains usable. Alternating motors
and software-only patterns use the software engine. A connection failure stops
the run instead of continuing blindly.

Read [Native patterns and compatibility](docs/native-patterns.md) for exact
boundaries and the upstream references.

## Reliability and identity

Ogg considers an explicitly supplied `BluetoothAddress` (standard MAC address format)
the strongest device identity, independently of server IP, device index and display
name. The updated IntiHA engine includes this extension in Buttplug v3
`DeviceAdded` and `DeviceList`. Other Intiface servers may not expose MAC
addresses; for those Ogg retains its previous conservative name/route matching.
Ogg cannot infer a physical MAC from a generic device name.


- Integration setup does not require a reachable server.
- Requests, connection attempts and shutdown waits are bounded.
- The server heartbeat is honoured when advertised.
- Repeated pulses replace their earlier run, and stop cancels pending activity.
- Disconnecting stops local pattern tasks and clears running state.
- Per-device settings and discovered devices survive a Home Assistant restart.
- A stop command is sent on normal disable/unload while the server is reachable.

**A device keeps the same Home Assistant identity when its server changes.** Ogg
matches its model and, when supplied, its distinct server display name across
all configured addresses. The server IP, address sensor, connection source,
server-local device index and advertised feature counts do not define that
identity. Ogg updates command routing to the current server and index while
keeping the existing device, entity IDs and settings. Actual device names are
preserved.

The [Buttplug v3 discovery protocol](https://buttplug.io/docs/spec-v3/spec/enumeration/)
does not expose a portable Bluetooth address or hardware serial number. If you
own multiple devices of the same model, give each a **different display name in
the server** and use that same name on every server. A Home Assistant-only
rename does not provide that identifier to Ogg. Indistinguishable devices are
kept separate when their identity is ambiguous; Ogg cannot reliably infer which
physical unit moved between servers without a distinct name.

When upgrading from Ogg 0.1.0, unambiguous copies created by different servers
are consolidated automatically. The first saved device keeps its identity,
settings and original Home Assistant entities. Redundant duplicate entities
are removed. Dashboards or automations that referred to those later duplicates
may need to be pointed back to the original entities. Ambiguous same-model
devices are left separate instead of guessing which settings belong to them.

An abrupt power or network loss prevents a final command from being delivered.
The server's own disconnect/watchdog behaviour remains the last line of control
in that case. Reconnection never replays the interrupted run.

## Naming and history

The integration name is Ogg. Actual device names are deliberately preserved.
Connection sensors include the active IP address as requested. Home Assistant's
normal recorder, backups, dashboards and user permissions still apply. If you
prefer no activity history, adapt [the recorder example](examples/recorder.yaml)
using your actual entity IDs.

## Moving from the old integration

1. Stop activity and disable the old integration so two clients do not compete.
2. Install and configure Ogg. It uses its own `ogg` domain and storage.
3. Check your device controls, then update dashboard cards and automations to the
   new entities. Existing `buttplug.*` identities are not automatically renamed.
4. Remove the old integration and its folder when you are happy with Ogg.

Compiled `.pyc` files from the old package are not required and are not shipped.

## Troubleshooting

| State or symptom | Check |
| --- | --- |
| Disabled | Turn on Ogg Enabled. |
| No addresses available | Add a manual address or wait for an IP sensor with a valid state. |
| Searching / reconnecting | Server running, correct address and port, local network access and firewall. |
| Connected, no devices | Bluetooth discovery mode, server permissions and competing applications. |
| Native selector absent | Model/capabilities do not qualify or this server does not expose raw access. Use software patterns. |
| Software cycles feel slow | Increase cycle period; Bluetooth/server latency limits achievable timing. |
| A device stays unavailable | Turn it on and use Search now; check that the server itself sees it. |

For an issue, include Ogg and Home Assistant versions, the displayed connection
state, server version and model family. Review logs or diagnostics before sharing
them. Ogg's diagnostics are designed to redact addresses and device names.

## Development and validation

See [Testing](docs/testing.md) and [Publishing](docs/publishing.md). The test suite
uses real Home Assistant APIs and synthetic local WebSocket servers. Automated
tests do not replace a first hardware check for a particular model and firmware.

The Ogg Python integration is licensed under GPL-3.0. The bundled Control Deck
JavaScript is Apache-2.0, as indicated in its header; see
[Frontend licence](custom_components/ogg/frontend/LICENSE).

### Per-device command permission and shared pulse duration (0.1.2)

Each known device has **Connect this device**, enabled by default. It is a command permission switch, **not** a Bluetooth connect/disconnect request: switching it off prevents run/pulse/manual output commands to that device, stops its current output, and excludes it from global starts. Device discovery remains active. Explicit stop operations are always permitted as a safety exception, including the server-wide Stop all command.

Each device also shows **Pulse duration (all devices)**. This is another Home Assistant control for the **same global timer**, not a separate timer per device. Changing it on any device updates every copy and the main Ogg controller.

### Pulse STOP safety net (v0.1.8)

After a timed Pulse (individual or Pulse all), Ogg sends an immediate per-device STOP and then repeats it at approximately **0.2, 2, 2.2, 10 and 10.2 seconds** afterwards, while the same device remains idle on the same server connection. These are three pairs of off commands, intended to catch late intensity writes and firmware-native patterns that continue after the first acknowledged STOP. A native-profile pulse repeats its native zero-output packet as well as `StopDeviceCmd` on every attempt.

A new **Run, Pulse, Stop or manual device output** in Ogg cancels outstanding backups for that device. A disconnected, rebound, disabled or shut-down device never receives a stale STOP through its previous server session. Existing Ogg reconnect safety still requires a verified STOP before resuming a valid desired Run/Pulse.

A server acknowledging STOP does not prove that a Bluetooth command reached the physical device. The delayed attempts are a *best-effort safeguard*, not a guarantee that hardware stops while disconnected. Commands from separate Intiface clients are not visible to Ogg and therefore cannot cancel these pending backups.

### v0.1.7: IntiHA connectivity troubleshooting

A known IntiHA device may be listed on the server before its Bluetooth session can accept a stop command. Ogg now keeps its server WebSocket open, marks only that device as recovering, and retries a verified stop when the device becomes ready. A device must not receive motor commands until its recovery STOP has been acknowledged.

If Ogg still displays **searching** rather than **connected**, check the configured IntiHA IP/host and port (default **12345**) in Ogg's integration options and the **Last error** sensor. Ogg will log a local Buttplug v3 handshake failure separately from a device recovery failure.

### Target versus device-reported intensity (v0.1.10)

The dashboard mini-chart shows a **dim dashed target** waveform (software approximation from the selected pattern) and a **bright device-reported** line when an IntiHA b19 We-Vibe info sensor is available. Device feedback is read by IntiHA from firmware, not a physical vibration accelerometer. Native patterns may report a set level rather than their fast internal oscillations. Unsupported hardware and other servers correctly show only the dim target line.

For devices whose names differ between Ogg and IntiHA, configure the card with a manual mapping (the Ogg device name on the left, the exact IntiHA sensor entity ID on the right):

```yaml
type: custom:ogg-control-deck-card
reported_intensity_entities:
  Bond: sensor.bond_device_reported_intensity
  Ditto: sensor.ditto_device_reported_intensity
```

The card otherwise auto-matches only when a name uniquely identifies an IntiHA device. A generic name or ambiguous match is not trusted. It never adds an extension to public Buttplug messages and does not change the pulse safety logic.

### Card resource version (0.1.13)

The dashboard footer should display `card v0.1.13`. If you still see the older tall server layout, Home Assistant may be using cached JavaScript. The automatically registered resource uses `/ogg/control-deck/ogg-control-deck-card.js?v=0.1.13`. Remove any obsolete duplicate resource such as `/local/ogg-control-deck-card.js` and refresh the dashboard.
