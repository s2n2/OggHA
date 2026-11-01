# Native patterns and compatibility

Ogg talks to a server using Buttplug v3 WebSocket messages. The server handles
Bluetooth and hardware discovery. Ogg does not connect directly to Bluetooth.

## Three independent requirements

Classic native patterns are attempted only when:

1. The exact server device name is in Ogg's classic-family allowlist and its
   vibration features advertise the expected 15-step resolution.
2. The device advertises `RawWriteCmd` with endpoint `tx` in its v3 capabilities.
3. The user selects the **Classic We-Vibe** native protocol for that device.

Matching the brand name alone is insufficient. Buttplug v3 does not expose the
underlying hardware protocol ID, so the explicit user selection remains necessary.
Custom server display names do not change the underlying model check.

## Why newer servers may use software patterns

The v3 protocol specification documents raw writes. That is a protocol feature,
not a promise that an engine will enable it. Current upstream development has
removed raw messages from newer interfaces and the v3 compatibility layer.
An installed engine can therefore offer ordinary intensity control without
exposing native modes. Ogg detects the advertised capabilities and continues
with its software engine in this case.

There is no universal instruction to "enable raw" in every current Intiface
version. Do not downgrade a working server just to make this selector appear.
The supported default path is the standard vibration interface.

## Classic hardware path

The classic protocol uses an eight-byte packet. Ogg controls the pattern byte,
two intensity nibbles and motor enable bits. A zero level clears the corresponding
enable bit. A full stop uses both a zero native packet where applicable and the
standard device stop command; intensity zero alone is not assumed to stop a
classic device.

Supported native names are Steady, Peak, Pulse, Echo, Wave, Tide, Surf, Bounce,
Massage, Tease, Crest, Chachacha, Step, Ramp, Tempo and Heartbeat. Firmware
availability can vary. An acknowledged raw write does not prove every model
implements every listed firmware pattern.

Classic candidates include the original Bloom, Ditto, Jive, Pivot, Rave, Verge,
Wish, 4 Plus, Gala, Nova, Sync and Classic when advertised with compatible
features. Newer similarly named versions are not matched by prefix.

The Moxie/Vector and Chorus families use different protocols. Newer devices such
as Nova 2 and various Sync successors must not receive the classic packet simply
because their names resemble an older model. Ogg uses software patterns for
these devices.

## Software behaviour

Software envelopes are Ogg's own designs. A software option sharing a native
name is an approximation, not a reverse-engineered copy of the manufacturer's
timing. Cycle period and alternating motor mode apply to this engine.

The selected envelope is multiplied by the device's intensity and each motor's
level. Unsupported actuators are excluded. A timed Pulse executes the selected
pattern for the configured burst duration; it is distinct from choosing the
repeating Pulse pattern.

Certain classic-family server drivers keep both motor-enable bits set during
scalar control, including for a zero-valued motor. The unselected motor can then
run at its minimum rather than stop. Standard scalar control cannot guarantee
independent off states on that combination; the whole-device Stop command remains
available. Native packets clear the corresponding bits when that path qualifies.

## Upstream references

- [Classic We-Vibe protocol and mode identifiers](https://buttplug.io/stpihkal/protocols/we-vibe/)
- [Buttplug v3 identification and heartbeat](https://buttplug.io/docs/spec-v3/spec/identification/)
- [Buttplug v3 device enumeration](https://buttplug.io/docs/spec-v3/spec/enumeration/)
- [Buttplug v3 generic commands](https://buttplug.io/docs/spec-v3/spec/generic/)
- [Buttplug v3 raw commands](https://buttplug.io/docs/spec-v3/spec/raw/)
- [Current classic implementation](https://github.com/buttplugio/buttplug/blob/master/crates/buttplug_server/src/device/protocol_impl/wevibe.rs)
- [Current 8-bit implementation](https://github.com/buttplugio/buttplug/blob/master/crates/buttplug_server/src/device/protocol_impl/wevibe8bit.rs)
- [Current Chorus implementation](https://github.com/buttplugio/buttplug/blob/master/crates/buttplug_server/src/device/protocol_impl/wevibe_chorus.rs)
- [Current server v3 compatibility enums](https://github.com/buttplugio/buttplug/blob/master/crates/buttplug_server/src/message/v3/spec_enums.rs)
