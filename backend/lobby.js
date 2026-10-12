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
  constructor(ctx, now = Date.now, createMatch = null) {
    this.ctx = ctx;
    this.now = now;
    this.createMatch = createMatch;
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
    if (
      ['queue', 'challenge'].includes(message.type) &&
      this.now() - player.lastAction < 500
    ) {
      this.send(ws, {
        type: 'error',
        text: 'Please wait before trying again.',
      });
      return;
    }
    if (message.type === 'challenge') {
      const target = this.players().find(
        (p) => p.deserializeAttachment().id === message.target,
      );
      const other = target?.deserializeAttachment();
      if (
        !other ||
        target === ws ||
        player.busy ||
        other.busy ||
        player.challenge ||
        other.challenge
      ) {
        this.send(ws, { type: 'error', text: 'This player is unavailable.' });
        return;
      }
      player.queued = false;
      other.queued = false;
      player.lastAction = this.now();
      player.challenge = {
        target: other.id,
        outgoing: true,
        expiresAt: this.now() + 30_000,
      };
      other.challenge = {
        target: player.id,
        outgoing: false,
        expiresAt: player.challenge.expiresAt,
      };
      ws.serializeAttachment(player);
      target.serializeAttachment(other);
      this.send(target, {
        type: 'challenge',
        opponent: { id: player.id, username: player.username },
      });
      this.broadcast();
      await this.schedule();
      return;
    }
    if (message.type === 'accept' || message.type === 'decline') {
      const invite = player.challenge;
      const target = this.players().find(
        (p) => p.deserializeAttachment().id === message.target,
      );
      const other = target?.deserializeAttachment();
      if (
        !invite ||
        invite.outgoing ||
        invite.target !== message.target ||
        !other?.challenge?.outgoing ||
        other.challenge.target !== player.id ||
        invite.expiresAt <= this.now() ||
        player.busy ||
        other.busy
      ) {
        this.send(ws, { type: 'error', text: 'This invitation has expired.' });
        return;
      }
      delete player.challenge;
      delete other.challenge;
      ws.serializeAttachment(player);
      target.serializeAttachment(other);
      if (message.type === 'accept') await this.pair(target, ws);
      else
        this.send(target, {
          type: 'invitation-ended',
          text: 'Play request declined.',
        });
      this.broadcast();
      await this.schedule();
      return;
    }
    if (message.type === 'status' && typeof message.busy === 'boolean') {
      player.busy = message.busy;
      player.queued = false;
    } else if (message.type === 'queue' && !player.busy && !player.challenge) {
      player.lastAction = this.now();
      player.queued = true;
    } else if (message.type === 'cancel') {
      player.queued = false;
    } else {
      this.send(ws, { type: 'error', text: 'Invalid lobby action.' });
      return;
    }
    ws.serializeAttachment(player);
    await this.match();
    this.broadcast();
    await this.schedule();
  }

  async match() {
    const waiting = this.players().filter((ws) => {
      const player = ws.deserializeAttachment();
      return player.queued && !player.busy && !player.challenge;
    });
    while (waiting.length >= 2)
      await this.pair(waiting.shift(), waiting.shift());
  }

  async pair(a, b) {
    const first = a.deserializeAttachment(),
      second = b.deserializeAttachment();
    for (const [ws, player] of [
      [a, first],
      [b, second],
    ]) {
      player.busy = true;
      player.queued = false;
      delete player.challenge;
      ws.serializeAttachment(player);
    }
    let game;
    try {
      game = this.createMatch
        ? await this.createMatch({ w: first.username, b: second.username })
        : null;
    } catch {
      for (const ws of [a, b]) {
        const player = ws.deserializeAttachment();
        player.busy = false;
        ws.serializeAttachment(player);
        this.send(ws, {
          type: 'error',
          text: 'Could not create a game. Please try again.',
        });
      }
      return;
    }
    for (const [ws, color, opponent] of [
      [b, 'b', first],
      [a, 'w', second],
    ])
      this.send(ws, {
        type: 'matched',
        opponent: { id: opponent.id, username: opponent.username },
        color,
        initiator: color === 'w',
        ...(game ? { game: { id: game.id, token: game.tokens[color] } } : {}),
      });
  }

  clearInvitation(ws, text = 'Play request expired.') {
    const player = ws.deserializeAttachment();
    if (!player?.challenge) return;
    const targetId = player.challenge.target;
    delete player.challenge;
    ws.serializeAttachment(player);
    this.send(ws, { type: 'invitation-ended', text });
    const target = this.players().find(
      (p) => p.deserializeAttachment().id === targetId,
    );
    const other = target?.deserializeAttachment();
    if (other?.challenge?.target === player.id) {
      delete other.challenge;
      target.serializeAttachment(other);
      this.send(target, { type: 'invitation-ended', text });
    }
  }

  remove(ws) {
    this.clearInvitation(ws);
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
      if (ws.deserializeAttachment().challenge?.expiresAt <= this.now())
        this.clearInvitation(ws);
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
      ...players.map((ws) => {
        const p = ws.deserializeAttachment();
        return Math.min(
          p.lastSeen + STALE_AFTER,
          p.challenge?.expiresAt ?? Infinity,
        );
      }),
    );
    await this.ctx.storage.setAlarm(earliest);
  }
}
