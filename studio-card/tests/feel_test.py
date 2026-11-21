"""Vibration-to-strokes in Home Assistant (studio/feel.py) matches the card's JavaScript.

Run with: python studio-card/tests/feel_test.py  (needs node for the parity check)
"""

import importlib.util
import json
import pathlib
import random
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
spec = importlib.util.spec_from_file_location("feel", ROOT / "custom_components/ogg/studio/feel.py")
feel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feel)

# The seeded generator is the card's, bit for bit (first values of seed 1).
r = feel.ai_random(1)
first = [r() for _ in range(3)]
assert all(0 <= x < 1 for x in first)

# A pulsing vibration becomes strokes, never jumps.
pulses = []
for t in range(0, 30000, 1000):
    pulses += [{"at": t, "pos": 0}, {"at": t + 50, "pos": 75}, {"at": t + 500, "pos": 75}, {"at": t + 550, "pos": 0}]
out = feel.vibe_to_stroke(pulses)
jumps = sum(1 for a, b in zip(out, out[1:]) if abs(b["pos"] - a["pos"]) >= 30 and b["at"] - a["at"] <= 60)
assert jumps == 0 and len(out) > 20
assert feel.vibe_to_stroke([]) == []

# A saved script for a stroker: strokes stay strokes, inside its stroke range.
stroke = {"actions": [{"at": 0, "pos": 0}, {"at": 600, "pos": 100}], "metadata": {"type": "stroke"}}
assert feel.stroker_script(stroke, None) == {"actions": [{"at": 0, "pos": 0}, {"at": 600, "pos": 100}]}
assert feel.stroker_script(stroke, {"max": 100, "lo": 20, "hi": 80, "speed": 100, "delay": 0})["actions"] == [{"at": 0, "pos": 20}, {"at": 600, "pos": 80}]
assert feel.stroker_script({"actions": pulses}, None)["actions"] == feel.vibe_to_stroke(pulses)

node = shutil.which("node")
if node:
    rng = random.Random(11)
    cases = []
    for _ in range(25):
        at, acts = 0, []
        for _ in range(rng.randint(1, 80)):
            at += rng.choice([1, 50, 100, rng.randint(2, 3000)])
            acts.append({"at": at, "pos": rng.randint(0, 100)})
        cases.append(acts)
    lib = (ROOT / "studio-card/src/lib").as_uri()
    js = f"""
      import {{ aiVibeToStroke, aiRandom }} from {json.dumps(lib + '/ai.js')};
      import {{ renderPattern }} from {json.dumps(lib + '/compose.js')};
      import {{ PATTERNS }} from {json.dumps(lib + '/patterns.js')};
      const r = aiRandom(1);
      const pats = Object.keys(PATTERNS).map((k) => renderPattern(k, 120000, {{ level: 70, speed: 50, seed: 5 }}).a);
      const cases = {json.dumps(cases)}.concat(pats);
      console.log(JSON.stringify({{ rand: [r(), r(), r()], cases, out: cases.map((c) => aiVibeToStroke(c).actions) }}));
    """
    proc = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr[-2000:]
    result = json.loads(proc.stdout)
    assert result["rand"] == first, (result["rand"], first)
    bad = 0
    for case, expected in zip(result["cases"], result["out"]):
        got = feel.vibe_to_stroke(case)
        if got != expected:
            bad += 1
            if bad < 3:
                diff = next(i for i, (g, e) in enumerate(zip(got, expected)) if g != e) if len(got) == len(expected) else "length"
                print("mismatch at", diff, got[:5], expected[:5])
    assert bad == 0, f"{bad} of {len(result['cases'])} differ"
    print(f"feel.py matches the card on {len(result['cases'])} scripts and patterns")
print("feel tests passed")
