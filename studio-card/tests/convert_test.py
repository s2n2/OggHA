"""Run modes in Home Assistant (convert.py) match the card's JavaScript.

Run with: python tests/convert_test.py  (needs node for the parity check)
"""

import importlib.util
import json
import pathlib
import random
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
spec = importlib.util.spec_from_file_location("convert", ROOT / "custom_components/ogg/studio/convert.py")
convert = importlib.util.module_from_spec(spec)
spec.loader.exec_module(convert)

stroke = [{"at": 0, "pos": 0}, {"at": 250, "pos": 100}, {"at": 500, "pos": 0}, {"at": 1500, "pos": 50}]
flat = lambda acts: " ".join(f"{a['at']}:{a['pos']}" for a in acts)  # noqa: E731
assert flat(convert.to_intensity(stroke, "speed")) == "0:100 249:100 250:100 499:100 500:13 1499:13 1500:0"
assert flat(convert.to_intensity(stroke, "down")) == "0:0 249:0 250:100 499:100 500:0 1499:0 1500:0"
assert flat(convert.to_intensity(stroke, "position")) == flat(stroke)
assert convert.move_intensity("combo", 100, 100, 1000) == 35
assert [x["pos"] for x in convert.to_intensity([{"at": 0, "pos": 30}, {"at": 1, "pos": 75}, {"at": 2, "pos": 100}], "upper")] == [0, 50, 100]

script = {"version": "1.0", "actions": stroke, "metadata": {"type": "stroke", "title": "x"}}
played = convert.run_script(script, None)
assert played["metadata"] == {"type": "vibration", "title": "x"}
assert flat(played["actions"]) == flat(convert.to_intensity(stroke, "speed")), "default run mode is speed"
vib = {"version": "1.0", "actions": stroke, "metadata": {"type": "vibration"}}
assert convert.run_script(vib, "down") is vib, "vibration scripts play unchanged"

# Parity with the card on random stroke scripts, every mode.
node = shutil.which("node")
if node:
    rng = random.Random(7)
    cases = []
    for _ in range(40):
        at, acts = 0, []
        for _ in range(rng.randint(1, 30)):
            at += rng.choice([0, 1, 2, rng.randint(3, 900)])
            acts.append({"at": at, "pos": rng.randint(0, 100)})
        cases.append(acts)
    js = f"""
      import {{ RUN_MODES, toIntensity }} from {json.dumps((ROOT / 'studio-card/src/lib/convert.js').as_uri())};
      const cases = {json.dumps(cases)};
      const out = {{}};
      for (const m of Object.keys(RUN_MODES)) out[m] = cases.map((c) => toIntensity(c, m));
      console.log(JSON.stringify(out));
    """
    proc = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr[-2000:]
    result = json.loads(proc.stdout)
    assert sorted(result) == sorted(convert.RUN_MODES)
    for mode, outs in result.items():
        for case, expected in zip(cases, outs):
            assert convert.to_intensity(case, mode) == expected, (mode, case)
    print(f"convert.py matches the card on {len(cases)} random scripts x {len(result)} modes")
print("convert tests passed")
