import $ from 'jquery';
import { Peer } from 'peerjs';
import { LobbyClient } from './lobby.js';
import { PeerSession } from './peer-session.js';
import { RecoveryClient } from './recovery.js';
import {
  Reset_Game,
  CheckMate,
  addMessage,
  update_board,
  turn_update,
  Reset_Sections,
} from './ui/utils.js';
import { chess } from './ui/setup.js';

export const socket = {
  peer: null,
  opponent: null,
  color: null,
  username: '',
  set_username: false,
  get_accepted: false,
  history: [],
  click: true,
  end_game: false,
  click_pos: { src: null, dst: null },
  playback: false,
  peers: {},
};
document.socket = socket;
document.Reset_Game = Reset_Game;
let queued = false,
  lobbyConnected = false,
  inviting = false,
  hidden = false;
const lobbyUrl =
  import.meta.env.VITE_LOBBY_URL ||
  (import.meta.env.DEV ? 'ws://localhost:8787/lobby' : '');
const notice = (text) => addMessage(text, 'Admin', { color: 'red' });
const recovery = (socket.recovery = new RecoveryClient(lobbyUrl, {
  onError: notice,
  onStatus(status) {
    $('#lobby-status').text(status);
    updateFindButton();
  },
  onState(state) {
    chess.restore(state);
    socket.color = recovery.active?.color;
    socket.history = structuredClone(chess.history);
    socket.end_game = false;
    socket.click = true;
    socket.click_pos = { src: null, dst: null };
    socket.playback = false;
    $('[dcr=promotion]').remove();
    $('#result').css({ 'z-index': 0, opacity: 0 });
    Reset_Sections();
    update_board();
    turn_update();
    if (state.result) CheckMate(state.result.winner, 'Resign');
    else if (chess.in_checkmate()) CheckMate(chess.turn === 'w' ? 'b' : 'w');
    else if (chess.in_draw()) {
      socket.end_game = true;
      addMessage('Game drawn.', 'Admin');
    }
  },
  onPresence() {
    reconnectOpponent();
  },
  peerReady: () => Boolean(socket.get_accepted && socket.opponent?.open),
  sendPeer: (data) => {
    if (socket.get_accepted && socket.opponent?.open)
      socket.opponent.send(data);
  },
  onForget(reason) {
    session.leave();
    lobby.setBusy(false);
    socket.color = null;
    $('#lobby-status').text(
      lobbyConnected ? 'Connected' : 'Lobby disconnected.',
    );
    if (reason) addMessage(reason, 'Admin');
    updateFindButton();
    renderPlayers();
  },
}));
if (recovery.active) {
  socket.username = recovery.active.username;
  socket.set_username = true;
  socket.color = recovery.active.color;
  $('.form').remove();
  $('.chat-messages ul').show();
  $('.chat-messages').css({
    'background-color': 'white',
    color: 'black',
    'text-align': 'left',
    display: 'block',
  });
}
const lobby = new LobbyClient(lobbyUrl, {
  onPlayers(peers) {
    socket.peers = Object.fromEntries(peers.map((peer) => [peer.id, peer]));
    queued = peers.find((peer) => peer.id === socket.peer.id)?.queued || false;
    if (!recovery.active && !queued && !inviting && lobbyConnected)
      $('#lobby-status').text('Connected');
    renderPlayers();
    updateFindButton();
  },
  onStatus(status) {
    lobbyConnected = status === 'Connected';
    if (!lobbyConnected) {
      queued = false;
      inviting = false;
      $('[dcr=request]').remove();
    }
    if (!recovery.active) $('#lobby-status').text(status);
    updateFindButton();
  },
  onError(text) {
    inviting = false;
    notice(text);
    updateFindButton();
  },
  onChallenge({ opponent }) {
    if (recovery.active) {
      lobby.send({ type: 'decline', target: opponent.id });
      return;
    }
    inviting = true;
    updateFindButton();
    renderPlayers();
    addRequest(
      opponent.username,
      () => {
        $('[dcr=request]').remove();
        lobby.send({ type: 'accept', target: opponent.id });
      },
      () => {
        $('[dcr=request]').remove();
        inviting = false;
        lobby.send({ type: 'decline', target: opponent.id });
        updateFindButton();
      },
    );
  },
  onInvitationEnded(text) {
    inviting = false;
    $('[dcr=request]').remove();
    addMessage(text, 'Admin');
    updateFindButton();
    renderPlayers();
  },
  onMatch(match) {
    queued = false;
    inviting = false;
    $('[dcr=request]').remove();
    if (!recovery.start(match, socket.username, socket.peer.id)) {
      lobby.setBusy(Boolean(recovery.active));
      return;
    }
    session.expect(match);
    lobby.setBusy(true);
    updateFindButton();
    renderPlayers();
    addMessage(
      `Playing ${match.opponent.username}. You are ${match.color === 'w' ? 'White' : 'Black'}.`,
      'Admin',
    );
  },
});

socket.peer = new Peer();
const session = new PeerSession(socket.peer, {
  getUsername: () => (socket.set_username ? socket.username : ''),
  getGameId: () => recovery.active?.id,
  onState(conn, accepted) {
    socket.opponent = conn;
    socket.get_accepted = accepted;
    socket.color = recovery.active?.color || null;
    lobby.setBusy(Boolean(recovery.active));
    recovery.peerChanged();
    updateFindButton();
    renderPlayers();
  },
  onStart() {
    recovery.peerChanged();
    recovery.send({ type: 'sync' });
  },
  onRequest(name, accept, deny) {
    deny();
  },
  onNotice(text) {
    if (!hidden) addMessage(text, 'Admin');
  },
  onData(data) {
    if (data.message === 'checkpoint') recovery.receive(data);
    else if (
      data.message === 'message' &&
      typeof data.text === 'string' &&
      data.text.length <= 2000
    )
      addMessage(data.text, socket.opponent.username);
  },
});

function reconnectOpponent() {
  if (hidden || !recovery.active || !socket.peer.open || !recovery.connected)
    return;
  const color = recovery.active.color;
  const opponent = recovery.peers[color === 'w' ? 'b' : 'w'];
  if (!opponent) {
    if (session.connection || session.expected) session.leave();
    return;
  }
  if (
    session.connection?.peer === opponent.id ||
    session.expected?.opponent.id === opponent.id
  )
    return;
  if (session.connection || session.expected) session.leave();
  session.expect({ opponent, color, initiator: color === 'w' });
}
const reconnectTimer = setInterval(reconnectOpponent, 3000);
socket.refreshLobby = () => {
  if (socket.peer.open && socket.set_username) {
    lobby.setBusy(Boolean(recovery.active));
    lobby.connect(socket.peer.id, socket.username);
  }
};
socket.leave = () => {
  if (socket.opponent?.open) socket.opponent.send({ message: 'leave' });
  if (recovery.active) recovery.forget('Left the online game.');
  else session.leave();
};
socket.peer.on('open', () => {
  if (hidden) return;
  socket.refreshLobby();
  if (recovery.active) recovery.connect(socket.peer.id);
});
socket.peer.on('disconnected', () => {
  lobby.stop();
  lobbyConnected = false;
  queued = false;
  socket.peers = {};
  renderPlayers();
  updateFindButton();
  if (!socket.peer.destroyed && !hidden) socket.peer.reconnect();
});
socket.peer.on('error', () => {
  if (recovery.active)
    notice(
      'Opponent connection failed. Your saved game is retained; reconnection will retry.',
    );
  else notice('Online connection failed. Local play is still available.');
});
socket.peer.on('close', () => {
  lobby.stop();
  lobbyConnected = false;
  socket.peers = {};
  session.leave();
  if (!recovery.active) $('#lobby-status').text('Online play disconnected.');
});
window.addEventListener('pagehide', () => {
  hidden = true;
  lobby.stop();
  recovery.pause();
  session.leave();
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  hidden = false;
  socket.refreshLobby();
  if (recovery.active && socket.peer.open) recovery.connect(socket.peer.id);
});
window.addEventListener('unload', () => clearInterval(reconnectTimer));

$('#find-opponent').on('click', () => {
  if (recovery.active || inviting || !socket.set_username) return;
  lobby.send({ type: queued ? 'cancel' : 'queue' });
});
function updateFindButton() {
  $('#find-opponent')
    .prop(
      'disabled',
      !lobbyConnected ||
        !socket.set_username ||
        Boolean(recovery.active) ||
        inviting,
    )
    .text(queued ? 'Cancel search' : 'Find opponent');
  $('#Resign').prop(
    'disabled',
    Boolean(recovery.active) && (!recovery.canMove() || socket.end_game),
  );
  $('#jsonfile, #load, #playGame, .undo, .redo, .play')
    .prop('disabled', Boolean(recovery.active))
    .attr('aria-disabled', String(Boolean(recovery.active)));
  if (queued && !recovery.active)
    $('#lobby-status').text('Waiting for another player…');
}
function renderPlayers() {
  const ul = $('<ul>');
  for (const peer of Object.values(socket.peers)) {
    if (peer.id === socket.peer.id) continue;
    const button = $('<button>', { type: 'button' }).text(
      `${peer.username}${peer.busy ? ' (Playing)' : ''}`,
    );
    button.prop(
      'disabled',
      peer.busy ||
        !socket.set_username ||
        Boolean(recovery.active) ||
        queued ||
        inviting,
    );
    button.on('click', () => {
      if (lobby.send({ type: 'challenge', target: peer.id })) {
        inviting = true;
        updateFindButton();
        renderPlayers();
        $('#lobby-status').text(`Waiting for ${peer.username} to accept…`);
        addMessage(`Sent a play request to ${peer.username}.`, 'Admin');
      }
    });
    ul.append($('<li>').append(button));
  }
  $('peers ul').remove();
  $('peers').append(ul);
  $('peers peer').text(
    socket.set_username ? socket.username : 'Choose a nickname to play online.',
  );
  if (
    lobbyConnected &&
    !Object.values(socket.peers).some((peer) => peer.id !== socket.peer.id)
  )
    ul.append(
      $('<li>').text('No other players yet. Invite someone to open this site.'),
    );
}
function addRequest(username, accept, deny) {
  const li = $('<li>').attr('dcr', 'request');
  li.append(
    $('<b>').text(`${username}: `),
    $('<span>').text('Would you like to play? '),
    $('<button>', { type: 'button' }).text('✓').on('click', accept),
    $('<button>', { type: 'button' }).text('✕').on('click', deny),
  );
  $('.chat-messages ul').append(li);
}
renderPlayers();
updateFindButton();
if (!lobbyUrl) $('#lobby-status').text('Online play is not configured.');
