"""Standalone watchdog smoke tests; uses AST import to avoid HA test dependencies."""
import ast
import asyncio
from dataclasses import dataclass
from pathlib import Path
import time
from types import MethodType, SimpleNamespace

text = Path(__file__).resolve().parent.parent.joinpath('custom_components/ogg/coordinator.py').read_text()
tree = ast.parse(text)
nodes = [n for n in tree.body if (isinstance(n, ast.ImportFrom) and n.module == '__future__') or (isinstance(n, ast.ClassDef) and n.name in ('DesiredOutput', 'OggHub'))]
namespace = {
    'asyncio': asyncio, 'time': time, 'dataclass': dataclass,
    'callback': lambda x: x, 'HomeAssistantError': RuntimeError,
    'RECONNECT_GRACE_SECONDS': 30.0,
    'PULSE_STOP_BACKUP_DELAYS': (.015, .035, .055, .075, .095),
    'build_classic_packet': lambda pattern, levels: bytes([15, 0, 0, 0, 0, 0, 0, 0]),
    'CommandError': type('CommandError',(Exception,), {}),
    'ProtocolError': type('ProtocolError',(Exception,), {}),
}
exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), '<coordinator AST>', 'exec'), namespace)
Hub=namespace['OggHub']

class FakeEntry:
    def async_create_background_task(self, hass, coro, name):
        return asyncio.create_task(coro, name=name)

class Client:
    connected = True


def make_hub():
    h=object.__new__(Hub)
    h.hass = object()
    h.entry = FakeEntry()
    h.enabled = True
    h._ready = True
    h._shutting_down = False
    h._operation_epoch = 0
    h._client = Client()
    h._runs = {}
    h._desired_outputs = {}
    h._stop_backups = {}
    h._command_serials = {}
    h._locks = {}
    h._event_tasks = set()
    h.pulse_duration=.045
    h._notify=lambda: None
    dev=SimpleNamespace(key='one', index=0, connected=True, commands_enabled=True,
        recovering=False, generation=1, running=False, mode='idle',remaining=None,
        motor_count=1, aux_values={}, last_error=None, engine='software',
        native_maybe_active=False, message_interval=.007)
    h.devices={'one':dev}
    h.sent=[]
    async def stop(self,device,client,**kwargs):
        self.sent.append(('off', time.monotonic(), kwargs))
        return True
    async def frame(self, device, client, elapsed, last_frame):
        self.sent.append(('on', time.monotonic(), {}))
        return ('on',)
    h._send_stop=MethodType(stop,h)
    h._send_frame=MethodType(frame,h)
    return h

async def run():
    h=make_hub()
    await h.async_start('one',pulse=True)
    await asyncio.sleep(.24)
    offs=[x for x in h.sent if x[0]=='off']
    assert len(offs)==7, h.sent # prestart + pulse finish + five backups
    assert h._stop_backups == {}, h._stop_backups
    assert not h.devices['one'].running
    print('test 1: STOP x6 after pulse + initial start STOP: PASS')

    h=make_hub()
    await h.async_start('one',pulse=True)
    while h.devices['one'].running:
        await asyncio.sleep(.003)
    await asyncio.sleep(.025) # give one backup time to fire
    await h.async_start('one',pulse=False)
    while not any(x[0]=='on' for x in h.sent[-2:]):
        await asyncio.sleep(.002)
    offset=len(h.sent)
    await asyncio.sleep(.17)
    assert h.devices['one'].running
    assert not any(x[0]=='off' for x in h.sent[offset:]), h.sent[offset:]
    assert h._stop_backups=={}
    await h.async_stop('one')
    print('test 2: new Run cannot be interrupted by backup STOP: PASS')

    h=make_hub()
    await h.async_start('one',pulse=True)
    while h.devices['one'].running:
        await asyncio.sleep(.002)
    h._client.connected=False
    await asyncio.sleep(.18)
    offs=[x for x in h.sent if x[0]=='off']
    assert len(offs)<=3, offs
    print('test 3: disconnected session cannot receive stale STOPs: PASS')

    h=make_hub()
    h.devices['one'].native_available=True
    class NativeClient(Client):
        def __init__(self):
            self.sent=[]
        async def raw_write(self,index,data):
            self.sent.append(('native-zero', bytes(data)))
        async def stop_device(self,index):
            self.sent.append(('stop-device', index))
    h._client=NativeClient()
    h._send_stop=MethodType(Hub._send_stop,h)
    async def native_frame(self, device, client, elapsed, last_frame):
        device.engine='native'
        device.native_maybe_active=True
        return ('native',)
    h._send_frame=MethodType(native_frame,h)
    await h.async_start('one', pulse=True)
    await asyncio.sleep(.22)
    native_zeros=[x for x in h._client.sent if x[0]=='native-zero']
    generic_stops=[x for x in h._client.sent if x[0]=='stop-device']
    assert len(native_zeros)==6, h._client.sent
    assert len(generic_stops)==7, h._client.sent
    print('test 4: native zero packet + generic STOP for every backup: PASS')

asyncio.run(run())
