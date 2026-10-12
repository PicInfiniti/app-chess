export class LobbyClient {
  constructor(
    url,
    { onPlayers, onMatch, onStatus, onError },
    WebSocketClass = WebSocket,
  ) {
    this.url = url;
    this.handlers = { onPlayers, onMatch, onStatus, onError };
    this.WebSocketClass = WebSocketClass;
    this.player = null;
    this.busy = false;
    this.retryDelay = 1000;
  }

  connect(id, username) {
    this.stop();
    this.player = { id, username };
    this.open();
  }

  open() {
    if (!this.player || !this.url) {
      this.handlers.onStatus('Online play is not configured.');
      return;
    }
    let url;
    try {
      url = new URL(this.url);
      if (url.protocol === 'https:') url.protocol = 'wss:';
      if (url.protocol === 'http:') url.protocol = 'ws:';
      if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error();
      url.searchParams.set('id', this.player.id);
      url.searchParams.set('username', this.player.username);
      this.ws = new this.WebSocketClass(url.href);
    } catch {
      this.handlers.onStatus('Online play is not configured correctly.');
      return;
    }
    const ws = this.ws;
    this.handlers.onStatus('Connecting to the lobby…');
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.retryDelay = 1000;
      this.handlers.onStatus('Connected');
      this.send({ type: 'status', busy: this.busy });
      this.heartbeat = setInterval(() => this.send({ type: 'ping' }), 25_000);
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastMessage > 60_000) ws.close();
      }, 10_000);
      this.lastMessage = Date.now();
    };
    ws.onmessage = (event) => {
      if (ws !== this.ws) return;
      this.lastMessage = Date.now();
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!data || typeof data !== 'object') return;
      if (data.type === 'players' && Array.isArray(data.peers))
        this.handlers.onPlayers(data.peers);
      else if (data.type === 'matched') this.handlers.onMatch(data);
      else if (data.type === 'error') this.handlers.onError(data.text);
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      clearInterval(this.heartbeat);
      clearInterval(this.watchdog);
      this.handlers.onPlayers([]);
      this.handlers.onStatus('Lobby disconnected. Reconnecting…');
      this.retry = setTimeout(() => this.open(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
    };
    ws.onerror = () => ws.close();
  }

  send(message) {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  setBusy(busy) {
    this.busy = busy;
    this.send({ type: 'status', busy });
  }

  stop() {
    this.player = null;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    clearInterval(this.watchdog);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
