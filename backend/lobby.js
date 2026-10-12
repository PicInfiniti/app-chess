const MAX_PLAYERS = 100;
const STALE_AFTER = 90_000;

export function validPlayer(id, username) {
  return (
    typeof id === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id) &&
    typeof username === 'string' &&
    username.trim().length > 0 &&
    username.length <= 32
  );
}

// All presence is held in hibernating WebSocket attachments, not process memory.
export class Lobby {
  constructor(ctx, now = Date.now) {
    this.ctx = ctx;
    this.now = now;
  }

  players() {
    return this.ctx.getWebSockets().filter((ws) => ws.deserializeAttachment());
  }

  send(ws, message) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      this.remove(ws);
    }
  }

  async join(ws, id, username) {
    if (!validPlayer(id, username)) throw new Error('Invalid player.');
    const players = this.players();
    if (players.length >= MAX_PLAYERS) throw new Error('The lobby is full.');
    if (players.some((p) => p.deserializeAttachment().id === id))
      throw new Error('This player is already in the lobby.');
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({
      id,
      username: username.trim(),
      busy: false,
      queued: false,
      lastSeen: this.now(),
      lastAction: 0,
    });
    this.broadcast();
    await this.schedule();
  }

  broadcast() {
    const players = this.players();
    const peers = players.map((ws) => {
      const { id, username, busy, queued } = ws.deserializeAttachment();
      return { id, username, busy, queued };
    });
    for (const ws of players) this.send(ws, { type: 'players', peers });
  }

  async message(ws, raw) {
    const player = ws.deserializeAttachment();
    if (!player) return;
    if (typeof raw !== 'string' || raw.length > 1024) {
      this.send(ws, { type: 'error', text: 'Invalid lobby message.' });
      return;
    }
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      this.send(ws, { type: 'error', text: 'Invalid lobby message.' });
      return;
    }
    if (!message || typeof message !== 'object') return;
    player.lastSeen = this.now();
    if (message.type === 'ping') {
      ws.serializeAttachment(player);
      this.send(ws, { type: 'pong' });
      return;
    }
    if (message.type === 'queue' && this.now() - player.lastAction < 500) {
      this.send(ws, {
        type: 'error',
        text: 'Please wait before trying again.',
      });
      return;
    }
    if (message.type === 'status' && typeof message.busy === 'boolean') {
      player.busy = message.busy;
      player.queued = false;
    } else if (message.type === 'queue' && !player.busy) {
      player.lastAction = this.now();
      player.queued = true;
    } else if (message.type === 'cancel') {
      player.queued = false;
    } else {
      this.send(ws, { type: 'error', text: 'Invalid lobby action.' });
      return;
    }
    ws.serializeAttachment(player);
    this.match();
    this.broadcast();
    await this.schedule();
  }

  match() {
    const waiting = this.players().filter((ws) => {
      const player = ws.deserializeAttachment();
      return player.queued && !player.busy;
    });
    while (waiting.length >= 2) {
      const a = waiting.shift();
      const b = waiting.shift();
      const first = a.deserializeAttachment();
      const second = b.deserializeAttachment();
      for (const [ws, player] of [
        [a, first],
        [b, second],
      ]) {
        player.busy = true;
        player.queued = false;
        ws.serializeAttachment(player);
      }
      this.send(b, {
        type: 'matched',
        opponent: { id: first.id, username: first.username },
        color: 'b',
        initiator: false,
      });
      this.send(a, {
        type: 'matched',
        opponent: { id: second.id, username: second.username },
        color: 'w',
        initiator: true,
      });
    }
  }

  remove(ws) {
    ws.serializeAttachment(null);
    try {
      ws.close(1000, 'Left the lobby');
    } catch {
      /* Already closed. */
    }
  }

  async close(ws) {
    this.remove(ws);
    this.broadcast();
    await this.schedule();
  }

  async alarm() {
    for (const ws of this.players()) {
      if (this.now() - ws.deserializeAttachment().lastSeen >= STALE_AFTER)
        this.remove(ws);
    }
    this.broadcast();
    await this.schedule();
  }

  async schedule() {
    const players = this.players();
    if (!players.length) return this.ctx.storage.deleteAlarm();
    const earliest = Math.min(
      ...players.map((ws) => ws.deserializeAttachment().lastSeen),
    );
    await this.ctx.storage.setAlarm(earliest + STALE_AFTER);
  }
}
