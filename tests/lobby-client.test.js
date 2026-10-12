import assert from 'node:assert/strict';
import test from 'node:test';
import { LobbyClient } from '../src/assets/js/lobby.js';

function fixture(t, url = 'https://lobby.example/lobby') {
  const sockets = [];
  class Socket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(raw) {
      this.sent.push(JSON.parse(raw));
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    open() {
      this.readyState = 1;
      this.onopen();
    }
    message(data) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
  const players = [],
    matches = [],
    statuses = [],
    errors = [];
  const client = new LobbyClient(
    url,
    {
      onPlayers: (data) => players.push(data),
      onMatch: (data) => matches.push(data),
      onStatus: (data) => statuses.push(data),
      onError: (data) => errors.push(data),
    },
    Socket,
  );
  t.after(() => client.stop());
  return { client, sockets, players, matches, statuses, errors };
}

test('the lobby connects only with a chosen identity and publishes busy state', (t) => {
  const f = fixture(t);
  f.client.setBusy(true);
  f.client.connect('alice', 'Alice & Bob');
  const ws = f.sockets[0];
  const url = new URL(ws.url);
  assert.equal(url.protocol, 'wss:');
  assert.equal(url.searchParams.get('username'), 'Alice & Bob');
  ws.open();
  assert.deepEqual(ws.sent[0], { type: 'status', busy: true });
  ws.message({ type: 'players', peers: [{ id: 'bob' }] });
  assert.equal(f.players[0][0].id, 'bob');
  ws.message({
    type: 'matched',
    opponent: { id: 'bob' },
    color: 'w',
    initiator: true,
  });
  assert.equal(f.matches.length, 1);
  ws.message(null);
  ws.message({ type: 'error', text: 'Full' });
  assert.deepEqual(f.errors, ['Full']);
});

test('disconnect clears the roster and reconnects without rejoining the queue', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const f = fixture(t);
  f.client.connect('alice', 'Alice');
  f.sockets[0].open();
  f.client.send({ type: 'queue' });
  f.sockets[0].close();
  assert.deepEqual(f.players.at(-1), []);
  t.mock.timers.tick(1000);
  assert.equal(f.sockets.length, 2);
  f.sockets[1].open();
  assert.deepEqual(f.sockets[1].sent, [{ type: 'status', busy: false }]);
  f.client.stop();
  t.mock.timers.tick(60_000);
  assert.equal(f.sockets.length, 2);
});

test('missing configuration leaves local play available without reconnect attempts', (t) => {
  const f = fixture(t, '');
  f.client.connect('alice', 'Alice');
  assert.equal(f.sockets.length, 0);
  assert.equal(f.statuses.at(-1), 'Online play is not configured.');
});
