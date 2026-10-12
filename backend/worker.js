import { DurableObject } from 'cloudflare:workers';
import { Lobby, validPlayer } from './lobby.js';
import { Game } from './game.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health')
      return Response.json({ status: 'ok', service: 'chess-lobby' });
    if (
      url.pathname !== '/lobby' &&
      !/^\/game\/[a-f0-9-]{36}$/.test(url.pathname)
    )
      return new Response('Not found', { status: 404 });
    const allowed = (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim());
    if (!allowed.includes(request.headers.get('Origin')))
      return new Response('Origin not allowed', { status: 403 });
    if (
      request.method !== 'GET' ||
      request.headers.get('Upgrade')?.toLowerCase() !== 'websocket'
    )
      return new Response('WebSocket connection required', { status: 426 });
    if (url.pathname.startsWith('/game/'))
      return env.GAMES.getByName(url.pathname.slice(6)).fetch(request);
    if (
      !validPlayer(url.searchParams.get('id'), url.searchParams.get('username'))
    )
      return new Response('Invalid player', { status: 400 });
    return env.LOBBY.getByName('public').fetch(request);
  },
};

export class ChessLobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.lobby = new Lobby(ctx, Date.now, async (usernames) => {
      const id = crypto.randomUUID();
      const tokens = await env.GAMES.getByName(id).initialize(usernames);
      return { id, tokens };
    });
  }

  fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const url = new URL(request.url);
      const pair = new WebSocketPair();
      try {
        await this.lobby.join(
          pair[1],
          url.searchParams.get('id'),
          url.searchParams.get('username'),
        );
      } catch (error) {
        return new Response(error.message, { status: 409 });
      }
      return new Response(null, { status: 101, webSocket: pair[0] });
    });
  }

  webSocketMessage(ws, message) {
    return this.ctx.blockConcurrencyWhile(() =>
      this.lobby.message(ws, message),
    );
  }
  webSocketClose(ws) {
    return this.ctx.blockConcurrencyWhile(() => this.lobby.close(ws));
  }
  webSocketError(ws) {
    return this.ctx.blockConcurrencyWhile(() => this.lobby.close(ws));
  }
  alarm() {
    return this.ctx.blockConcurrencyWhile(() => this.lobby.alarm());
  }
}

export class ChessGame extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = new Game(ctx);
  }
  initialize(usernames) {
    return this.ctx.blockConcurrencyWhile(() =>
      this.game.initialize(usernames),
    );
  }
  fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const pair = new WebSocketPair();
      const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '')
        .split(',')
        .map((p) => p.trim());
      if (protocols[0] !== 'chess-game' || protocols.length !== 2)
        return new Response('Game authentication required', { status: 403 });
      try {
        await this.game.join(
          pair[1],
          protocols[1],
          new URL(request.url).searchParams.get('peerId'),
        );
      } catch (error) {
        return new Response(error.message, { status: 403 });
      }
      return new Response(null, {
        status: 101,
        webSocket: pair[0],
        headers: { 'Sec-WebSocket-Protocol': 'chess-game' },
      });
    });
  }
  webSocketMessage(ws, raw) {
    return this.ctx.blockConcurrencyWhile(() => this.game.message(ws, raw));
  }
  webSocketClose(ws) {
    return this.ctx.blockConcurrencyWhile(() => this.game.close(ws));
  }
  webSocketError(ws) {
    return this.webSocketClose(ws);
  }
  alarm() {
    return this.ctx.blockConcurrencyWhile(() => this.game.alarm());
  }
}
