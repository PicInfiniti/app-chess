import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { PeerSession } from '../src/assets/js/peer-session.js';

class Connection extends EventEmitter {
  constructor(id) {
    super();
    this.peer = id;
    this.sent = [];
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.emit('close');
  }
}
function fixture(t) {
  const peer = new EventEmitter();
  peer.connect = (id) => new Connection(id);
  const received = [];
  let started = 0;
  let request;
  const session = new PeerSession(peer, {
    getUsername: () => 'Alice',
    onState() {},
    onStart() {
      started++;
    },
    onRequest(name, accept, deny) {
      request = { name, accept, deny };
    },
    onNotice() {},
    onData: (data) => received.push(data),
  });
  t.after(() => session.leave());
  return {
    peer,
    session,
    received,
    get started() {
      return started;
    },
    get request() {
      return request;
    },
  };
}

test('the same incoming connection is accepted and used for bidirectional play', (t) => {
  const f = fixture(t);
  const conn = new Connection('bob');
  f.peer.emit('connection', conn);
  conn.emit('data', { message: 'hi', username: 'Bob', color: 'w' });
  assert.equal(f.session.accepted, false);
  conn.emit('data', { message: 'move' });
  assert.equal(f.received.length, 0);
  f.request.accept();
  assert.equal(f.session.connection, conn);
  assert.equal(f.session.color, 'b');
  assert.equal(f.started, 1);
  assert.equal(conn.sent[0].message, 'accepted');
  conn.emit('data', { message: 'move' });
  assert.equal(f.received.length, 1);
});

test('unrelated peers cannot move, reset, resign, or spoof acceptance', (t) => {
  const f = fixture(t);
  f.session.request('bob', 'Bob');
  const opponent = f.session.connection;
  const stranger = new Connection('mallory');
  f.peer.emit('connection', stranger);
  for (const message of ['accepted', 'move', 'reset', 'resign'])
    stranger.emit('data', { message });
  assert.equal(f.started, 0);
  assert.equal(f.received.length, 0);
  opponent.emit('data', { message: 'accepted' });
  stranger.emit('data', { message: 'move' });
  assert.equal(f.received.length, 0);
  opponent.emit('data', { message: 'move' });
  assert.equal(f.received.length, 1);
});

test('queued matches auto-accept only the expected opponent', (t) => {
  const f = fixture(t);
  f.session.expect({
    opponent: { id: 'bob', username: 'Bob' },
    color: 'b',
    initiator: false,
  });
  const stranger = new Connection('mallory');
  f.peer.emit('connection', stranger);
  stranger.emit('data', { message: 'hi', username: 'Mallory', color: 'w' });
  assert.equal(stranger.sent[0].message, 'rejected');
  assert.equal(f.started, 0);
  const bob = new Connection('bob');
  f.peer.emit('connection', bob);
  bob.emit('data', { message: 'hi', username: 'Bob', color: 'w' });
  assert.equal(f.started, 1);
  assert.equal(f.session.color, 'b');
});

test('old connections cannot clear a new match, and queued attempts time out', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  f.session.request('bob', 'Bob');
  const old = f.session.connection;
  f.session.leave();
  f.session.request('charlie', 'Charlie');
  old.emit('close');
  assert.equal(f.session.connection.peer, 'charlie');
  t.mock.timers.tick(20_000);
  assert.equal(f.session.connection, null);
});

test('pairing completes when the PeerJS offer arrives before the lobby notification', (t) => {
  const f = fixture(t);
  const bob = new Connection('bob');
  f.peer.emit('connection', bob);
  bob.emit('data', { message: 'hi', username: 'Bob', color: 'w' });
  assert.equal(f.started, 0);
  assert.equal(
    f.session.expect({
      opponent: { id: 'bob', username: 'Bob' },
      color: 'b',
      initiator: false,
    }),
    true,
  );
  assert.equal(f.started, 1);
  assert.equal(f.session.accepted, true);
  assert.equal(bob.sent[0].message, 'accepted');
});

test('recovery sessions reject unsolicited peers and handshakes from another game', (t) => {
  const f = fixture(t);
  f.session.handlers.getGameId = () => 'current-game';
  const unsolicited = new Connection('bob');
  f.peer.emit('connection', unsolicited);
  unsolicited.emit('data', {
    message: 'hi',
    username: 'Bob',
    color: 'w',
    gameId: 'current-game',
  });
  assert.equal(unsolicited.sent[0].message, 'rejected');
  f.session.expect({
    opponent: { id: 'bob', username: 'Bob' },
    color: 'b',
    initiator: false,
  });
  const stale = new Connection('bob');
  f.peer.emit('connection', stale);
  stale.emit('data', {
    message: 'hi',
    username: 'Bob',
    color: 'w',
    gameId: 'old-game',
  });
  assert.equal(stale.sent[0].message, 'rejected');
  assert.equal(f.started, 0);
  const current = new Connection('bob');
  f.peer.emit('connection', current);
  current.emit('data', {
    message: 'hi',
    username: 'Bob',
    color: 'w',
    gameId: 'current-game',
  });
  assert.equal(f.started, 1);
  assert.equal(current.sent[0].gameId, 'current-game');
});
