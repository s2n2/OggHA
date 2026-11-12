// Screen-off playback: the timelines handed to Ogg (no browser needed).
import assert from 'assert';
import { levelTrack, moveTrack, simplify } from '../src/card/screenoff.js';

// simplify keeps the shape: a straight ramp is two points, a corner stays.
const ramp = Array.from({ length: 11 }, (_, i) => ({ at: i * 100, pos: i * 10 }));
assert.deepStrictEqual(simplify(ramp), [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }]);
const tri = [...ramp, ...Array.from({ length: 10 }, (_, i) => ({ at: 1100 + i * 100, pos: 90 - i * 10 }))];
assert.deepStrictEqual(simplify(tri).map((p) => p.pos), [0, 100, 0]);

// Levels every 100 ms ramp as they did live; a held level holds, then steps.
const sends = [{ at: 0, lv: [0.2] }, { at: 100, lv: [0.4] }, { at: 600, lv: [0.4] }, { at: 1500, lv: [0.9] }];
assert.deepStrictEqual(levelTrack(sends, 0, 2000), [
  { at: 0, pos: 20 }, { at: 100, pos: 40 }, { at: 1499, pos: 40 }, { at: 1500, pos: 90 }, { at: 2000, pos: 90 }]);
// A one-motor send drives the second motor's track too.
assert.strictEqual(levelTrack(sends, 1, 2000)[1].pos, 40);

// Moves: arrive at each goal; one cut short by a newer move stops part way.
const moves = [{ at: 0, goal: 100, dur: 400 }, { at: 200, goal: 0, dur: 200 }, { at: 1000, goal: 50, dur: 100 }];
assert.deepStrictEqual(moveTrack(moves, 1500), [
  { at: 200, pos: 100 }, { at: 400, pos: 0 }, { at: 1000, pos: 0 }, { at: 1100, pos: 50 }, { at: 1500, pos: 50 }]);
// Never past the end (a loop is exactly as long as the rest).
const cut = moveTrack([{ at: 0, goal: 0, dur: 100 }, { at: 900, goal: 100, dur: 200 }], 1000);
assert.deepStrictEqual(cut[cut.length - 1], { at: 1000, pos: 50 });
assert.ok(cut.every((p) => p.at <= 1000));
console.log('screen-off timelines passed');
