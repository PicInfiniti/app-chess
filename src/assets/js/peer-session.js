// One bidirectional PeerJS connection per match. Ignore game data from strangers.
export class PeerSession {
  constructor(peer, handlers) {
    this.peer = peer;
    this.handlers = handlers;
    this.connection = null;
    this.accepted = false;
    peer.on('connection', (conn) => this.attach(conn));
  }

  expect(match) {
    // The PeerJS offer can arrive before its lobby notification.
    if (
      this.connection?.peer === match.opponent.id &&
      !this.connection.outgoing &&
      !this.accepted &&
      this.pendingAccept
    ) {
      this.color = match.color;
      this.connection.color = match.color === 'w' ? 'b' : 'w';
      this.pendingAccept();
      return true;
    }
    if (this.connection || this.expected) return false;
    this.expected = match;
    this.timeout = setTimeout(
      () => this.leave('Could not connect to the opponent.'),
      20_000,
    );
    if (match.initiator) {
      this.expected = null;
      return this.request(
        match.opponent.id,
        match.opponent.username,
        match.color,
      );
    }
    this.handlers.onState(null, false, match.color);
    return true;
  }

  request(id, username, color = 'w') {
    if (this.connection || this.expected) return false;
    const conn = this.peer.connect(id, { reliable: true });
    conn.username = username;
    conn.color = color === 'w' ? 'b' : 'w';
    conn.outgoing = true;
    this.connection = conn;
    this.color = color;
    this.attach(conn);
    this.handlers.onState(conn, false, color);
    clearTimeout(this.timeout);
    this.timeout = setTimeout(
      () => this.leave('The play request timed out.'),
      20_000,
    );
    conn.on('open', () => {
      if (this.connection !== conn) return;
      conn.send({
        message: 'hi',
        username: this.handlers.getUsername(),
        color,
      });
    });
    return true;
  }

  attach(conn) {
    conn.on('data', (data) => {
      if (!data || typeof data !== 'object' || typeof data.message !== 'string')
        return;
      if (data.message === 'hi' && !conn.outgoing) {
        if (this.connection === conn) return;
        if (
          this.connection ||
          !this.handlers.getUsername() ||
          (this.expected && this.expected.opponent.id !== conn.peer) ||
          (this.expected && this.expected.color === data.color) ||
          !['w', 'b'].includes(data.color) ||
          typeof data.username !== 'string' ||
          !data.username.trim() ||
          data.username.length > 32
        ) {
          conn.send({ message: 'rejected' });
          conn.close();
          return;
        }
        const expected = this.expected;
        this.expected = null;
        clearTimeout(this.timeout);
        conn.username = data.username;
        conn.color = data.color;
        this.color = expected?.color || (data.color === 'w' ? 'b' : 'w');
        this.connection = conn;
        this.handlers.onState(conn, false, this.color);
        this.timeout = setTimeout(
          () => this.leave('The play request timed out.'),
          20_000,
        );
        const accept = () => {
          if (this.connection !== conn || this.accepted) return;
          conn.send({ message: 'accepted' });
          this.begin(conn);
        };
        const deny = () => {
          if (this.connection !== conn || this.accepted) return;
          conn.send({ message: 'rejected' });
          this.leave('Play request declined.');
        };
        this.pendingAccept = accept;
        if (expected) accept();
        else this.handlers.onRequest(conn.username, accept, deny);
        return;
      }
      if (this.connection !== conn) return;
      if (data.message === 'accepted' && conn.outgoing && !this.accepted)
        this.begin(conn);
      else if (data.message === 'rejected' && !this.accepted)
        this.leave('Play request declined.');
      else if (data.message === 'leave')
        this.leave(`${conn.username} left the game.`);
      else if (this.accepted) this.handlers.onData(data);
    });
    conn.on('close', () => {
      if (this.connection === conn)
        this.leave('Opponent disconnected. You can save this game.');
    });
    conn.on('error', () => {
      if (this.connection === conn)
        this.leave('Could not connect to the opponent.');
    });
  }

  begin(conn) {
    clearTimeout(this.timeout);
    this.accepted = true;
    this.pendingAccept = null;
    this.handlers.onState(conn, true, this.color);
    this.handlers.onStart();
  }

  leave(reason) {
    clearTimeout(this.timeout);
    const conn = this.connection;
    this.connection = null;
    this.expected = null;
    this.pendingAccept = null;
    this.accepted = false;
    this.handlers.onState(null, false, null);
    conn?.close();
    if (reason) this.handlers.onNotice(reason);
  }
}
