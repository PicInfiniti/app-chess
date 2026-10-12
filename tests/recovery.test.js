import assert from 'node:assert/strict';
import test from 'node:test';
import Desk from '../src/assets/js/lib/desk.js';
import { RecoveryClient, RECOVERY_KEY } from '../src/assets/js/recovery.js';
import { EMPTY_STATE, checkpointHash } from '../shared/checkpoint.js';
const match = {
  color: 'w',
  game: { id: '12345678-1234-1234-1234-123456789abc', token: 'a'.repeat(64) },
};
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
class WS {
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    this.sent = [];
  }
  open() {
    this.readyState = 1;
    this.onopen();
  }
  send(raw) {
    this.sent.push(JSON.parse(raw));
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  async deliver(client, data) {
    this.onmessage({ data: JSON.stringify(data) });
    await client.processing;
  }
}
function fixture(t, store = storage()) {
  const states = [],
    errors = [],
    peerData = [],
    statuses = [];
  let peerReady = true;
  const client = new RecoveryClient(
    'ws://localhost:8787/lobby',
    {
      onState: (state) => states.push(structuredClone(state)),
      onError: (error) => errors.push(error),
      onPresence() {},
      onStatus: (status) => statuses.push(status),
      onForget() {},
      peerReady: () => peerReady,
      sendPeer: (message) => peerData.push(message),
    },
    { storage: store, WebSocketClass: WS, now: () => 1000 },
  );
  t.after(() => client.pause());
  return {
    client,
    store,
    states,
    errors,
    peerData,
    statuses,
    peerReady: (ready) => {
      peerReady = ready;
    },
  };
}
async function ready(f, color = 'w') {
  f.client.start({ ...match, color }, 'Alice', 'alice');
  const ws = f.client.ws;
  ws.open();
  await ws.deliver(f.client, {
    type: 'snapshot',
    color,
    state: EMPTY_STATE,
    hash: await checkpointHash(EMPTY_STATE),
    expiresAt: 86_401_000,
  });
  await ws.deliver(f.client, {
    type: 'presence',
    peers: { w: { id: 'alice' }, b: { id: 'bob' } },
  });
  return ws;
}
function nextState() {
  const desk = new Desk();
  desk.move({ piece: desk.get('6-4'), dst: '4-4', type: 'move' });
  return { ...desk.checkpoint(), result: null };
}

test('play waits for authenticated recovery, opponent presence, and PeerJS', async (t) => {
  const f = fixture(t);
  assert.equal(f.client.canMove(), false);
  const ws = await ready(f);
  assert.equal(f.client.canMove(), true);
  f.peerReady(false);
  assert.equal(f.client.canMove(), false);
  f.peerReady(true);
  await ws.deliver(f.client, {
    type: 'presence',
    peers: { w: { id: 'alice' } },
  });
  assert.equal(f.client.canMove(), false);
});

test('a proposed move is locked and stored locally until both players commit it', async (t) => {
  const f = fixture(t),
    ws = await ready(f),
    state = nextState();
  await f.client.propose(state);
  assert.equal(f.client.canMove(), false);
  assert.equal(
    JSON.parse(f.store.getItem(RECOVERY_KEY)).outbox.state.moves[0],
    'e2e4',
  );
  assert.equal(JSON.stringify(f.peerData).includes(match.game.token), false);
  await ws.deliver(f.client, {
    type: 'committed',
    state,
    hash: await checkpointHash(state),
    expiresAt: 86_402_000,
  });
  assert.equal(f.client.canMove(), true);
  assert.equal(JSON.parse(f.store.getItem(RECOVERY_KEY)).outbox, null);
});

test('refresh restores the same seat and resubmits a legal unconfirmed move once', async (t) => {
  const f = fixture(t),
    ws = await ready(f),
    state = nextState();
  await f.client.propose(state);
  f.client.pause();
  const refreshed = fixture(t, f.store);
  assert.equal(refreshed.client.active.color, 'w');
  refreshed.client.connect('new-alice');
  refreshed.client.ws.open();
  await refreshed.client.ws.deliver(refreshed.client, {
    type: 'snapshot',
    color: 'w',
    state: EMPTY_STATE,
    hash: await checkpointHash(EMPTY_STATE),
    expiresAt: 86_401_000,
  });
  assert.equal(
    refreshed.client.ws.sent.filter((m) => m.type === 'checkpoint').length,
    1,
  );
  assert.equal(
    new URL(refreshed.client.ws.url).searchParams.get('peerId'),
    'new-alice',
  );
  assert.equal(refreshed.client.ws.url.includes(match.game.token), false);
  assert.equal(ws.readyState, 3);
});

test('a pending server checkpoint survives refresh and is independently verified and confirmed', async (t) => {
  const f = fixture(t),
    ws = await ready(f, 'b'),
    state = nextState(),
    hash = await checkpointHash(state);
  await ws.deliver(f.client, {
    type: 'snapshot',
    color: 'b',
    state: EMPTY_STATE,
    hash: await checkpointHash(EMPTY_STATE),
    expiresAt: 86_401_000,
    pending: { state, hash, proposer: 'w', confirmations: ['w'] },
  });
  assert.deepEqual(f.states.at(-1), state);
  assert.equal(f.client.canMove(), false);
  assert.deepEqual(ws.sent.at(-1), { type: 'checkpoint', state, hash });
});

test('illegal peer moves, mismatched FENs, wrong hashes and unrelated games cannot be confirmed', async (t) => {
  const f = fixture(t),
    ws = await ready(f, 'b'),
    count = ws.sent.length;
  const illegal = { moves: ['e2e5'], fen: EMPTY_STATE.fen, result: null };
  for (const state of [illegal, { ...nextState(), fen: EMPTY_STATE.fen }]) {
    f.client.receive({
      message: 'checkpoint',
      gameId: match.game.id,
      state,
      hash: await checkpointHash(state),
      proposer: 'w',
    });
    await f.client.processing;
  }
  f.client.receive({
    gameId: match.game.id,
    state: nextState(),
    hash: 'bad',
    proposer: 'w',
  });
  await f.client.processing;
  f.client.receive({
    gameId: 'other-game',
    state: nextState(),
    hash: await checkpointHash(nextState()),
    proposer: 'w',
  });
  await f.client.processing;
  assert.equal(ws.sent.length, count);
  assert.equal(f.errors.length, 3);
  assert.deepEqual(f.client.committed, EMPTY_STATE);
});

test('a replaced tab stops reconnecting; old sockets cannot change a new session', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture(t),
    old = await ready(f);
  old.close(4001);
  t.mock.timers.tick(60_000);
  assert.equal(f.client.ws, null);
  assert.equal(f.client.suspended, true);
  f.client.connect('new-alice');
  const current = f.client.ws;
  await old.deliver(f.client, { type: 'expired' });
  assert.ok(f.client.active);
  assert.equal(f.client.ws, current);
});

test('explicit leave removes credentials, while page pause preserves them', async (t) => {
  const f = fixture(t);
  await ready(f);
  f.client.pause();
  assert.ok(f.store.getItem(RECOVERY_KEY));
  f.client.forget();
  assert.equal(f.store.getItem(RECOVERY_KEY), null);
  assert.equal(f.client.active, null);
});

test('expired credentials and blocked browser storage do not start an online game', (t) => {
  const store = storage();
  store.setItem(
    RECOVERY_KEY,
    JSON.stringify({
      ...match.game,
      color: 'w',
      username: 'Alice',
      expiresAt: 500,
    }),
  );
  const f = fixture(t, store);
  assert.equal(f.client.active, null);
  store.setItem = () => {
    throw new Error('Blocked');
  };
  assert.equal(f.client.start(match, 'Alice', 'alice'), false);
  assert.equal(f.client.active, null);
  assert.equal(f.errors.length, 1);
});

test('resignation is part of the recoverable checkpoint and requires confirmation', async (t) => {
  const f = fixture(t),
    ws = await ready(f);
  await f.client.resign();
  const state = f.client.pending.state;
  assert.deepEqual(state.result, { winner: 'b', reason: 'resign' });
  assert.equal(f.client.canMove(), false);
  await ws.deliver(f.client, {
    type: 'committed',
    state,
    hash: await checkpointHash(state),
    expiresAt: 86_402_000,
  });
  assert.equal(f.client.canMove(), false);
  assert.deepEqual(f.client.committed.result, state.result);
});
