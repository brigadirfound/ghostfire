// Regression checks for the replay timeline. Run: node tools/check_replay.mjs
import assert from 'node:assert/strict';
import { Recorder, decode } from '../js/replay.js';

const pos = (x = 1, y = 2, z = 3) => ({ x, y, z });

// A shot is stamped with the next replay tick. Encoding must therefore close
// the timeline with a frame first, including for a kill on the very first tick.
{
  const recorder = new Recorder(20);
  recorder.markShot(2, 2);
  assert.equal(recorder.frames.length, 0);
  assert.equal(recorder.ensureFinalFrame(pos(), 0.25, -0.1, 2), true);

  const replay = decode(recorder.encode());
  assert.equal(replay.frames.length, 1);
  assert.deepEqual(replay.shots, [{ tick: 0, weapon: 2, hit: 2 }]);
  assert.equal(replay.sample(0).weapon, 2);
}

// If the regular per-frame update already closed the event tick, finalization
// must be idempotent rather than stretching the recorded run.
{
  const recorder = new Recorder(20);
  recorder.update(0.05, pos(4, 5, 6), 0, 0, 0);
  recorder.markShot(0, 1);
  recorder.update(0.05, pos(4, 5, 6), 0, 0, 0);
  assert.equal(recorder.ensureFinalFrame(pos(4, 5, 6), 0, 0, 0), false);
  assert.equal(recorder.frames.length, 2);
  assert.equal(decode(recorder.encode()).shots[0].tick, 1);
}

// Head rate is conditional on a hit. The ghost applies accuracy separately.
{
  const recorder = new Recorder(20);
  recorder.frames.push({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0 });
  recorder.shots.push(
    { tick: 0, weapon: 0, hit: 2 },
    { tick: 0, weapon: 0, hit: 1 },
    { tick: 0, weapon: 0, hit: 0 },
    { tick: 0, weapon: 0, hit: 0 },
  );
  assert.deepEqual(decode(recorder.encode()).accuracyProfile(), {
    accuracy: 0.5,
    headRate: 0.5,
    shots: 4,
  });
}

// Events outside the frame timeline are rejected instead of becoming silent,
// unreachable shots in a shared challenge.
{
  const recorder = new Recorder(20);
  recorder.frames.push({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0 });
  recorder.markShot(0, 0);
  assert.throws(() => recorder.encode(), /invalid shot/);
}

// Crafted but finite Float32 angles must interpolate in constant time. A loop
// that repeatedly adds/subtracts 2π effectively hangs on values near 1e38.
{
  const recorder = new Recorder(20);
  recorder.frames.push(
    { x: 0, y: 0, z: 0, yaw: -3e38, pitch: 0, flags: 0 },
    { x: 0, y: 0, z: 0, yaw: 3e38, pitch: 0, flags: 0 },
  );
  assert.equal(Number.isFinite(decode(recorder.encode()).sample(0.025).yaw), true);
}

// Frame weapon bits are validated as strictly as shot/pickup weapon ids.
{
  const recorder = new Recorder(20);
  recorder.frames.push({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 7 << 1 });
  assert.throws(() => recorder.encode(), /invalid frame/);
}

console.log('Replay timeline checks passed');
