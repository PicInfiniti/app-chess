import assert from 'node:assert/strict';
import test from 'node:test';
import { Lobby } from '../backend/lobby.js';

function fixture() {
  let time = 1000;
  const sockets = [];
  const ctx = {
    getWebSockets: () => sockets,
    acceptWebSocket: (ws) => sockets.push(ws),
    storage: {
      async setAlarm(value) {
        ctx.alarm = value;
      },
      async deleteAlarm() {
        ctx.alarm = null;
      },
    },
  };
  const lobby = new Lobby(ctx, () => time);
  return {
    ctx,
    lobby,
    advance: (ms) => {
      time += ms;
    },
    async join(id, username = id) {
      const ws = {
        messages: [],
        serializeAttachment(data) {
          this.data = structuredClone(data);
        },
        deserializeAttachment() {
          return structuredClone(this.data);
        },
        send(message) {
          this.messages.push(JSON.parse(message));
        },
        close() {
          this.closed = true;
        },
      };
      await lobby.join(ws, id, username);
      return ws;
    },
  };
}
const action = (lobby, ws, data) => lobby.message(ws, JSON.stringify(data));

test('two queued strangers are paired once, with opposite colors', async () => {
  const f = fixture();
  const a = await f.join('alice');
  const b = await f.join('bob');
  const c = await f.join('charlie');
  await action(f.lobby, a, { type: 'queue' });
  await action(f.lobby, b, { type: 'queue' });
  await action(f.lobby, c, { type: 'queue' });
  assert.deepEqual(
    a.messages.find((m) => m.type === 'matched'),
    {
      type: 'matched',
      opponent: { id: 'bob', username: 'bob' },
      color: 'w',
      initiator: true,
    },
  );
  assert.equal(b.messages.find((m) => m.type === 'matched').color, 'b');
  assert.equal(
    c.messages.some((m) => m.type === 'matched'),
    false,
  );
  assert.equal(a.data.busy, true);
  assert.equal(a.data.queued, false);
  assert.equal(c.data.queued, true);
});

test('busy and canceled players are not matched; leaving makes a player available', async () => {
  const f = fixture();
  const a = await f.join('alice');
  const b = await f.join('bob');
  await action(f.lobby, a, { type: 'queue' });
  f.advance(501);
  await action(f.lobby, a, { type: 'cancel' });
  await action(f.lobby, a, { type: 'status', busy: true });
  await action(f.lobby, b, { type: 'queue' });
  assert.equal(
    b.messages.some((m) => m.type === 'matched'),
    false,
  );
  await action(f.lobby, a, { type: 'status', busy: false });
  f.advance(501);
  await action(f.lobby, a, { type: 'queue' });
  assert.equal(b.messages.filter((m) => m.type === 'matched').length, 1);
});

test('hibernation preserves presence and waiting players', async () => {
  const f = fixture();
  const a = await f.join('alice');
  const b = await f.join('bob');
  await action(f.lobby, a, { type: 'queue' });
  const resumed = new Lobby(f.ctx, () => 2000);
  await action(resumed, b, { type: 'queue' });
  assert.equal(a.messages.filter((m) => m.type === 'matched').length, 1);
});

test('disconnect and stale-player cleanup remove presence and cancel queue entries', async () => {
  const f = fixture();
  const a = await f.join('alice');
  const b = await f.join('bob');
  await f.lobby.close(a);
  assert.deepEqual(
    b.messages.at(-1).peers.map((p) => p.id),
    ['bob'],
  );
  f.advance(90_000);
  await f.lobby.alarm();
  assert.equal(b.closed, true);
  assert.equal(f.ctx.alarm, null);
});

test('pings keep live players present without broadcasting a new roster', async () => {
  const f = fixture();
  const a = await f.join('alice');
  const b = await f.join('bob');
  const count = a.messages.length;
  f.advance(60_000);
  await action(f.lobby, b, { type: 'ping' });
  assert.equal(a.messages.length, count);
  f.advance(30_000);
  await f.lobby.alarm();
  assert.equal(a.closed, true);
  assert.equal(b.closed, undefined);
  assert.equal(f.ctx.alarm, 151_000);
});

test('invalid identities, duplicate IDs, malformed messages and action bursts are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.join('bad id'));
  await assert.rejects(f.join('valid', ' '));
  const a = await f.join('alice');
  await assert.rejects(f.join('alice'));
  await f.lobby.message(a, '{');
  assert.equal(a.messages.at(-1).type, 'error');
  await f.lobby.message(a, 'x'.repeat(1025));
  assert.equal(a.messages.at(-1).type, 'error');
  await action(f.lobby, a, { type: 'queue' });
  await action(f.lobby, a, { type: 'queue' });
  assert.equal(a.messages.at(-1).type, 'error');
  assert.equal(a.data.queued, true);
  await action(f.lobby, a, { type: 'cancel' });
  assert.equal(a.data.queued, false);
});

test('the lobby limits concurrent players', async () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) await f.join(`player-${i}`);
  await assert.rejects(f.join('overflow'), /full/);
});
