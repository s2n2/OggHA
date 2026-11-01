# Testing

The development harness pins Home Assistant 2026.10.4 through
`pytest-homeassistant-custom-component==0.13.375` and uses Python 3.14. The
integration itself targets Home Assistant 2025.10 and later.

## Validation snapshot, 1 November 2026

- **168 tests passed** on Python 3.14.8 and Home Assistant 2026.10.4.
- Ruff passed for the integration and tests.
- Manifest and translation JSON, dashboard examples and workflow YAML parsed.
- The declared minimum Home Assistant version was not separately exercised.
- Physical devices and the GitHub-hosted HACS/hassfest jobs were not exercised
  in this local test run.

## Run locally

```bash
python3.14 -m venv .venv
.venv/bin/python -m pip install pytest-homeassistant-custom-component==0.13.375 ruff==0.17.3
.venv/bin/ruff check custom_components tests
.venv/bin/python -m pytest
```

The test server listens on loopback with an ephemeral port. Tests never connect
to real devices or a user's configured server. Failure injection covers closed
sockets, missing acknowledgements, rejected commands and malformed messages.

The suite checks protocol negotiation, hotplug events, request correlation,
timeouts, heartbeat behaviour, model/feature gates, pattern bounds, explicit
stop packets, offline setup, failover, pulse cancellation and lifecycle races.
Native recovery is checked on a fresh WebSocket session, both for devices in
the initial snapshot and those discovered later by a `DeviceAdded` event. An
explicit off packet must arrive before a later user start, and previous positive
output is not replayed.
A passing suite establishes those simulated cases, not every combination
of phone OS, Bluetooth driver, server build and physical firmware.

Before using a new model, verify discovery, a short low-intensity pulse, the
individual stop, Stop all and reconnect behaviour with the device accessible.
Confirm that the Pattern engine sensor matches the path you intend to use.

The GitHub workflow also runs hassfest and the HACS repository validator. The
brands check is omitted for this custom repository; default-catalogue submission
has additional requirements.
