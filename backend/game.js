import {
  EMPTY_STATE,
  checkpointHash,
  digest,
  canonical,
  validState,
  validTransition,
} from '../shared/checkpoint.js';
import { validPlayer } from './lobby.js';
export const GAME_TTL = 24 * 60 * 60 * 1000;
const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
export async function createGameRecord(usernames, now = Date.now()) {
  const tokens = { w: token(), b: token() };
  const players = {};
  for (const color of ['w', 'b'])
    players[color] = {
      username: usernames[color],
      tokenHash: await digest(tokens[color]),
    };
  return {
    tokens,
    record: {
      players,
      state: structuredClone(EMPTY_STATE),
      hash: await checkpointHash(EMPTY_STATE),
      pending: null,
      expiresAt: now + GAME_TTL,
    },
  };
}

export class Game {
  constructor(ctx, now = Date.now) {
    this.ctx = ctx;
    this.now = now;
  }
  async initialize(usernames) {
    if (await this.ctx.storage.get('game'))
      throw new Error('Game already exists.');
    const { tokens, record } = await createGameRecord(usernames, this.now());
    await this.save(record);
    return tokens;
  }
  async save(record) {
    await this.ctx.storage.transaction(async (storage) => {
      await storage.put('game', record);
      await storage.setAlarm(record.expiresAt);
    });
  }
  async record() {
    const record = await this.ctx.storage.get('game');
    if (!record || record.expiresAt <= this.now()) {
      if (record) await this.expire();
      return null;
    }
    return record;
  }
  sockets() {
    return this.ctx.getWebSockets().filter((ws) => ws.deserializeAttachment());
  }
  send(ws, message) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      ws.serializeAttachment(null);
    }
  }
  broadcast(message) {
    for (const ws of this.sockets()) this.send(ws, message);
  }
  presence(record) {
    const peers = {};
    for (const ws of this.sockets()) {
      const player = ws.deserializeAttachment();
      if (this.now() - player.lastSeen < 90_000)
        peers[player.color] = {
          id: player.peerId,
          username: record.players[player.color].username,
        };
    }
    return { type: 'presence', peers };
  }
  async join(ws, credential, peerId) {
    const record = await this.record();
    if (!record) throw new Error('Game expired or unavailable.');
    if (typeof credential !== 'string' || !/^[a-f0-9]{64}$/.test(credential))
      throw new Error('Invalid game token.');
    const hash = await digest(credential);
    const color = ['w', 'b'].find(
      (seat) => record.players[seat].tokenHash === hash,
    );
    if (!color || !validPlayer(peerId, record.players[color].username))
      throw new Error('Invalid game token or peer identity.');
    for (const old of this.sockets())
      if (old.deserializeAttachment().color === color) {
        old.serializeAttachment(null);
        old.close(4001, 'This seat was opened in another tab.');
      }
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ color, peerId, lastSeen: this.now() });
    this.send(ws, {
      type: 'snapshot',
      color,
      state: record.state,
      hash: record.hash,
      pending: record.pending,
      expiresAt: record.expiresAt,
      usernames: { w: record.players.w.username, b: record.players.b.username },
    });
    this.broadcast(this.presence(record));
  }
  async message(ws, raw) {
    const player = ws.deserializeAttachment();
    if (!player) return;
    const record = await this.record();
    if (!record) return;
    let data;
    try {
      if (typeof raw !== 'string' || raw.length > 16_000) throw new Error();
      data = JSON.parse(raw);
      if (!data || typeof data !== 'object') throw new Error();
    } catch {
      this.send(ws, { type: 'error', text: 'Invalid game message.' });
      return;
    }
    player.lastSeen = this.now();
    ws.serializeAttachment(player);
    if (data.type === 'ping') {
      this.send(ws, { type: 'pong' });
      this.send(ws, this.presence(record));
      return;
    }
    if (data.type === 'sync') {
      this.send(ws, {
        type: 'committed',
        state: record.state,
        hash: record.hash,
        expiresAt: record.expiresAt,
      });
      if (record.pending)
        this.send(ws, { type: 'candidate', ...record.pending });
      return;
    }
    if (
      data.type !== 'checkpoint' ||
      !validState(data.state) ||
      data.hash !== (await checkpointHash(data.state))
    ) {
      this.send(ws, { type: 'error', text: 'Invalid checkpoint.' });
      return;
    }
    if (
      data.hash === record.hash &&
      canonical(data.state) === canonical(record.state)
    ) {
      this.send(ws, {
        type: 'committed',
        state: record.state,
        hash: record.hash,
        expiresAt: record.expiresAt,
      });
      return;
    }
    if (!record.pending) {
      if (!validTransition(record.state, data.state, player.color)) {
        this.send(ws, { type: 'error', text: 'Checkpoint out of sequence.' });
        return;
      }
      record.pending = {
        state: JSON.parse(canonical(data.state)),
        hash: data.hash,
        proposer: player.color,
        confirmations: [player.color],
      };
      await this.save(record);
      this.broadcast({ type: 'candidate', ...record.pending });
      return;
    }
    if (
      record.pending.hash !== data.hash ||
      canonical(record.pending.state) !== canonical(data.state)
    ) {
      this.send(ws, {
        type: 'error',
        text: 'Checkpoint conflicts with the pending move.',
      });
      return;
    }
    if (!record.pending.confirmations.includes(player.color))
      record.pending.confirmations.push(player.color);
    if (record.pending.confirmations.length === 2) {
      record.state = record.pending.state;
      record.hash = record.pending.hash;
      record.pending = null;
      record.expiresAt = this.now() + GAME_TTL;
      await this.save(record);
      this.broadcast({
        type: 'committed',
        state: record.state,
        hash: record.hash,
        expiresAt: record.expiresAt,
      });
    }
  }
  async close(ws) {
    ws.serializeAttachment(null);
    try {
      ws.close(1000, 'Disconnected');
    } catch {
      /* Already closed. */
    }
    const record = await this.record();
    if (record) this.broadcast(this.presence(record));
  }
  async expire() {
    for (const ws of this.sockets()) {
      this.send(ws, { type: 'expired' });
      ws.serializeAttachment(null);
      ws.close(4004, 'Saved game expired.');
    }
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    const record = await this.ctx.storage.get('game');
    if (!record || record.expiresAt <= this.now()) await this.expire();
    else await this.ctx.storage.setAlarm(record.expiresAt);
  }
}
