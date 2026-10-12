import assert from 'node:assert/strict';
import test from 'node:test';
import { Game, GAME_TTL } from '../backend/game.js';
import { EMPTY_STATE, checkpointHash } from '../shared/checkpoint.js';
import Desk from '../src/assets/js/lib/desk.js';

function fixture() {
  let now = 1000;
  const sockets = [],
    values = new Map();
  const storage = {
    async get(key) {
      return structuredClone(values.get(key));
    },
    async put(key, value) {
      values.set(key, structuredClone(value));
    },
    async setAlarm(value) {
      storage.alarm = value;
    },
    async deleteAlarm() {
      storage.alarm = null;
    },
    async deleteAll() {
      values.clear();
    },
    async transaction(fn) {
      return fn(storage);
    },
  };
  const ctx = {
    storage,
    getWebSockets: () => sockets,
    acceptWebSocket: (ws) => sockets.push(ws),
  };
  const game = new Game(ctx, () => now);
  return {
    game,
    ctx,
    values,
    advance(ms) {
      now += ms;
    },
    async join(token, peerId) {
      const ws = {
        messages: [],
        serializeAttachment(value) {
          this.data = structuredClone(value);
        },
        deserializeAttachment() {
          return structuredClone(this.data);
        },
        send(raw) {
          this.messages.push(JSON.parse(raw));
        },
        close(code) {
          this.closed = code;
        },
      };
      await game.join(ws, token, peerId);
      return ws;
    },
  };
}
const submit = async (game, ws, state) =>
  game.message(
    ws,
    JSON.stringify({
      type: 'checkpoint',
      state,
      hash: await checkpointHash(state),
    }),
  );
function firstMove() {
  const desk = new Desk();
  desk.move({ piece: desk.get('6-4'), dst: '4-4', type: 'move' });
  return { ...desk.checkpoint(), result: null };
}

test('private seat credentials are independent, hashed at rest, and never broadcast', async () => {
  const f = fixture(),
    tokens = await f.game.initialize({ w: 'Alice', b: 'Bob' });
  assert.notEqual(tokens.w, tokens.b);
  const w = await f.join(tokens.w, 'alice'),
    b = await f.join(tokens.b, 'bob');
  assert.equal(w.messages[0].color, 'w');
  assert.equal(b.messages[0].color, 'b');
  for (const text of [
    JSON.stringify([...f.values]),
    JSON.stringify(w.messages),
    JSON.stringify(b.messages),
  ]) {
    assert.equal(text.includes(tokens.w), false);
    assert.equal(text.includes(tokens.b), false);
  }
  await assert.rejects(f.join('a'.repeat(64), 'stranger'), /Invalid/);
  await assert.rejects(f.game.initialize({ w: 'x', b: 'y' }), /already/);
});

test('a single seat cannot commit, duplicate confirmations cannot extend retention', async () => {
  const f = fixture(),
    tokens = await f.game.initialize({ w: 'Alice', b: 'Bob' });
  const w = await f.join(tokens.w, 'alice'),
    b = await f.join(tokens.b, 'bob');
  const state = firstMove(),
    expiry = f.ctx.storage.alarm;
  f.advance(10_000);
  await submit(f.game, w, state);
  await submit(f.game, w, state);
  assert.deepEqual((await f.game.record()).state, EMPTY_STATE);
  assert.equal(f.ctx.storage.alarm, expiry);
  await submit(f.game, b, state);
  assert.deepEqual((await f.game.record()).state, state);
  assert.equal(f.ctx.storage.alarm, expiry + 10_000);
  f.advance(10_000);
  await submit(f.game, w, state);
  assert.equal(f.ctx.storage.alarm, expiry + 10_000);
});

test('mismatched state, wrong turn, bad hashes and conflicting checkpoints are rejected', async () => {
  const f = fixture(),
    tokens = await f.game.initialize({ w: 'Alice', b: 'Bob' });
  const w = await f.join(tokens.w, 'alice'),
    b = await f.join(tokens.b, 'bob'),
    state = firstMove();
  await submit(f.game, b, state);
  assert.equal(b.messages.at(-1).type, 'error');
  await f.game.message(
    w,
    JSON.stringify({ type: 'checkpoint', state, hash: 'bad' }),
  );
  assert.equal(w.messages.at(-1).type, 'error');
  await submit(f.game, w, state);
  await submit(f.game, b, { ...state, fen: EMPTY_STATE.fen });
  assert.equal(b.messages.at(-1).type, 'error');
  assert.deepEqual((await f.game.record()).state, EMPTY_STATE);
  await f.game.message(w, 'x'.repeat(16_001));
  assert.equal(w.messages.at(-1).type, 'error');
});

test('hibernation and refresh preserve committed and pending state; a new peer replaces the same seat', async () => {
  const f = fixture(),
    tokens = await f.game.initialize({ w: 'Alice', b: 'Bob' });
  const w = await f.join(tokens.w, 'alice'),
    b = await f.join(tokens.b, 'bob'),
    state = firstMove();
  await submit(f.game, w, state);
  const resumed = new Game(f.ctx, () => 2000);
  await submit(resumed, b, state);
  const refreshed = await f.join(tokens.w, 'new-alice');
  assert.equal(w.closed, 4001);
  assert.equal(w.data, null);
  assert.deepEqual(refreshed.messages[0].state, state);
  assert.equal(b.messages.at(-1).peers.w.id, 'new-alice');
  await f.game.message(w, JSON.stringify({ type: 'ping' }));
  assert.equal(w.data, null);
});

test('alarms delete games and tokens even when both players have left, and retries are safe', async () => {
  const f = fixture(),
    tokens = await f.game.initialize({ w: 'Alice', b: 'Bob' });
  const w = await f.join(tokens.w, 'alice'),
    b = await f.join(tokens.b, 'bob');
  await f.game.close(w);
  await f.game.close(b);
  f.advance(GAME_TTL - 1);
  await f.game.alarm();
  assert.equal(f.values.size, 1);
  f.advance(1);
  await f.game.alarm();
  await f.game.alarm();
  assert.equal(f.values.size, 0);
  assert.equal(f.ctx.storage.alarm, null);
  await assert.rejects(f.join(tokens.w, 'alice'), /expired/);
});

test('expired games cannot resume even if the alarm has not fired yet', async () => {
  const f = fixture(),
    tokens = await f.game.initialize({ w: 'Alice', b: 'Bob' });
  const w = await f.join(tokens.w, 'alice');
  f.advance(GAME_TTL);
  await assert.rejects(f.join(tokens.b, 'bob'), /expired/);
  assert.equal(w.closed, 4004);
  assert.equal(f.values.size, 0);
});

test('pings and reconnections do not extend game retention', async () => {
  const f = fixture(),
    tokens = await f.game.initialize({ w: 'Alice', b: 'Bob' });
  const w = await f.join(tokens.w, 'alice'),
    expiry = f.ctx.storage.alarm;
  f.advance(60_000);
  await f.game.message(w, JSON.stringify({ type: 'ping' }));
  await f.join(tokens.w, 'new-alice');
  assert.equal(f.ctx.storage.alarm, expiry);
});
