import { DurableObject } from 'cloudflare:workers';
import { Lobby, validPlayer } from './lobby.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health')
      return Response.json({ status: 'ok', service: 'chess-lobby' });
    if (url.pathname !== '/lobby')
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
    this.lobby = new Lobby(ctx);
  }

  async fetch(request) {
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
  }

  webSocketMessage(ws, message) {
    return this.lobby.message(ws, message);
  }
  webSocketClose(ws) {
    return this.lobby.close(ws);
  }
  webSocketError(ws) {
    return this.lobby.close(ws);
  }
  alarm() {
    return this.lobby.alarm();
  }
}
