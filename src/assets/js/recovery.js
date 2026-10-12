import Desk from './lib/desk.js';
import {
  EMPTY_STATE,
  MAX_MOVES,
  canonical,
  checkpointHash,
  validState,
  validTransition,
} from '../../../shared/checkpoint.js';
export const RECOVERY_KEY = 'chess.active-game.v1';
const other = (color) => (color === 'w' ? 'b' : 'w');
export function validateCheckpoint(state) {
  if (!validState(state)) throw new Error('Invalid game checkpoint.');
  const desk = new Desk();
  desk.restore(state);
  if (state.result && desk.engine.isGameOver())
    throw new Error('Cannot resign a finished game.');
  return desk;
}

// Credentials stay in this browser. Neither PeerJS messages nor public presence
// contain either player's recovery token.
export class RecoveryClient {
  constructor(
    url,
    handlers,
    { storage = localStorage, WebSocketClass = WebSocket, now = Date.now } = {},
  ) {
    this.url = url;
    this.handlers = handlers;
    this.storage = storage;
    this.WebSocketClass = WebSocketClass;
    this.now = now;
    this.active = null;
    this.committed = structuredClone(EMPTY_STATE);
    this.pending = null;
    this.peers = {};
    this.connected = false;
    this.ready = false;
    this.retryDelay = 1000;
    this.processing = Promise.resolve();
    try {
      const saved = JSON.parse(storage.getItem(RECOVERY_KEY));
      if (
        saved &&
        /^[a-f0-9-]{36}$/.test(saved.id) &&
        /^[a-f0-9]{64}$/.test(saved.token) &&
        ['w', 'b'].includes(saved.color) &&
        typeof saved.username === 'string' &&
        saved.username.length > 0 &&
        saved.username.length <= 32 &&
        saved.expiresAt > now()
      )
        this.active = saved;
      else storage.removeItem(RECOVERY_KEY);
    } catch {
      /* Local play remains available when browser storage is blocked. */
    }
  }
  persist() {
    try {
      this.storage.setItem(RECOVERY_KEY, JSON.stringify(this.active));
      return true;
    } catch {
      this.handlers.onError(
        'Browser storage is unavailable. Enable it to recover online games after refresh.',
      );
      return false;
    }
  }
  start(match, username, peerId) {
    if (!match.game || this.active) return false;
    this.active = {
      ...match.game,
      color: match.color,
      username,
      expiresAt: this.now() + 86_400_000,
      outbox: null,
    };
    if (!this.persist()) {
      this.active = null;
      return false;
    }
    this.committed = structuredClone(EMPTY_STATE);
    this.pending = null;
    this.handlers.onState(this.committed, false);
    this.connect(peerId);
    return true;
  }
  connect(peerId) {
    this.pause();
    this.suspended = false;
    this.peerId = peerId;
    if (this.active) this.open();
  }
  open() {
    if (!this.active || this.suspended) return;
    if (this.active.expiresAt <= this.now()) {
      this.forget('Saved game expired.');
      return;
    }
    const url = new URL(this.url);
    url.protocol =
      url.protocol === 'https:'
        ? 'wss:'
        : url.protocol === 'http:'
          ? 'ws:'
          : url.protocol;
    url.pathname = '/game/' + this.active.id;
    url.search = '';
    url.searchParams.set('peerId', this.peerId);
    const ws = (this.ws = new this.WebSocketClass(url.href, [
      'chess-game',
      this.active.token,
    ]));
    this.ready = false;
    this.notify();
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.connected = true;
      this.retryDelay = 1000;
      this.lastMessage = this.now();
      this.notify();
      this.heartbeat = setInterval(() => {
        if (this.now() - this.lastMessage > 60_000) ws.close();
        else this.send({ type: 'ping' });
      }, 20_000);
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      this.lastMessage = this.now();
      this.processing = this.processing
        .then(async () => {
          if (this.ws !== ws) return;
          let data;
          try {
            data = JSON.parse(event.data);
          } catch {
            return;
          }
          await this.handle(data, ws);
        })
        .catch(() => {
          if (this.ws === ws) {
            this.ready = false;
            this.notify();
            this.handlers.onError('Invalid recovery data. The game is paused.');
          }
        });
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.connected = false;
      this.ready = false;
      this.peers = {};
      clearInterval(this.heartbeat);
      this.handlers.onPresence(this.peers);
      this.notify();
      if (event.code === 4004) {
        this.forget('Saved game expired.');
        return;
      }
      if (event.code === 4001) {
        this.suspended = true;
        this.handlers.onError(
          'This game is open in another tab. Continue there, or refresh this tab to reclaim your seat.',
        );
        return;
      }
      this.retry = setTimeout(() => this.open(), this.retryDelay);
      this.retryDelay = Math.min(30_000, this.retryDelay * 2);
    };
    ws.onerror = () => ws.close();
  }
  async verified(state, hash) {
    validateCheckpoint(state);
    if ((await checkpointHash(state)) !== hash)
      throw new Error('Checkpoint hash mismatch.');
  }
  async handle(data, ws) {
    if (!this.active || !data || typeof data !== 'object') return;
    if (data.type === 'expired') {
      this.forget('Saved game expired.');
      return;
    }
    if (data.type === 'presence') {
      this.peers = data.peers || {};
      this.handlers.onPresence(this.peers);
      this.notify();
      return;
    }
    if (data.type === 'error') {
      this.active.outbox = null;
      this.persist();
      this.ready = false;
      this.handlers.onError(data.text);
      this.send({ type: 'sync' });
      return;
    }
    if (data.type === 'snapshot' || data.type === 'committed') {
      await this.verified(data.state, data.hash);
      if (this.ws !== ws || !this.active) return;
      if (data.type === 'snapshot' && data.color !== this.active.color)
        throw new Error('Wrong game seat.');
      this.committed = data.state;
      this.hash = data.hash;
      this.pending = null;
      this.ready = true;
      this.active.expiresAt = data.expiresAt;
      const outbox = this.active.outbox;
      if (outbox && canonical(outbox.state) === canonical(data.state))
        this.active.outbox = null;
      this.persist();
      this.handlers.onState(data.state, true);
      this.notify();
      if (data.pending) await this.candidate(data.pending, ws);
      else if (
        this.active.outbox &&
        validTransition(data.state, this.active.outbox.state, this.active.color)
      ) {
        await this.propose(this.active.outbox.state, true);
      } else if (this.active.outbox) {
        this.active.outbox = null;
        this.persist();
      }
    } else if (data.type === 'candidate') await this.candidate(data, ws);
  }
  async candidate(data, ws = this.ws) {
    if (!this.active || data.hash === this.hash) return;
    await this.verified(data.state, data.hash);
    if (ws !== this.ws || !this.active) return;
    if (!validTransition(this.committed, data.state, data.proposer))
      throw new Error('Checkpoint is out of sequence.');
    const previous = validateCheckpoint(this.committed);
    if (previous.engine.isGameOver()) throw new Error('Game already finished.');
    this.pending = data;
    this.ready = false;
    this.handlers.onState(data.state, false);
    this.notify();
    if (!data.confirmations?.includes(this.active.color))
      this.send({ type: 'checkpoint', state: data.state, hash: data.hash });
  }
  receive(data) {
    if (
      !this.active ||
      data.gameId !== this.active.id ||
      data.proposer !== other(this.active.color)
    )
      return;
    const ws = this.ws;
    this.processing = this.processing
      .then(() => this.candidate(data, ws))
      .catch(() =>
        this.handlers.onError('An illegal or inconsistent move was rejected.'),
      );
  }
  canMove() {
    return Boolean(
      this.active &&
      this.connected &&
      this.ready &&
      !this.pending &&
      !this.committed.result &&
      this.committed.moves.length < MAX_MOVES &&
      this.peers[other(this.active.color)] &&
      this.handlers.peerReady(),
    );
  }
  async propose(state, replay = false) {
    if (!this.active || (!replay && !this.canMove())) return false;
    state = { ...state, result: state.result || null };
    if (!validTransition(this.committed, state, this.active.color))
      return false;
    validateCheckpoint(state);
    this.ready = false;
    this.pending = { state };
    this.notify();
    const active = this.active,
      hash = await checkpointHash(state);
    if (this.active !== active) return false;
    active.outbox = { state, hash };
    if (!this.persist()) {
      this.handlers.onState(this.committed, true);
      this.pending = null;
      this.notify();
      return false;
    }
    const message = { state, hash, proposer: active.color, gameId: active.id };
    this.pending = message;
    this.handlers.sendPeer({ ...message, message: 'checkpoint' });
    this.send({ type: 'checkpoint', state, hash });
    this.handlers.onState(state, false);
    return true;
  }
  resign() {
    if (
      !this.canMove() ||
      validateCheckpoint(this.committed).engine.isGameOver()
    )
      return false;
    return this.propose({
      ...this.committed,
      result: { winner: other(this.active.color), reason: 'resign' },
    });
  }
  send(data) {
    if (this.ws?.readyState !== 1) return false;
    try {
      this.ws.send(JSON.stringify(data));
      return true;
    } catch {
      this.ws.close();
      return false;
    }
  }
  notify() {
    this.handlers.onStatus(
      !this.connected
        ? 'Reconnecting to saved game…'
        : !this.ready
          ? 'Waiting for both players to confirm…'
          : !this.peers[other(this.active?.color)]
            ? 'Game recovered. Waiting for opponent…'
            : !this.handlers.peerReady()
              ? 'Reconnecting to opponent…'
              : 'Connected — game saved',
    );
  }
  peerChanged() {
    if (this.active) this.notify();
  }
  pause() {
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    this.ready = false;
    this.peers = {};
    ws?.close();
  }
  forget(reason) {
    this.pause();
    this.active = null;
    this.pending = null;
    try {
      this.storage.removeItem(RECOVERY_KEY);
    } catch {
      /* Storage may be blocked. */
    }
    this.handlers.onForget(reason);
  }
}
