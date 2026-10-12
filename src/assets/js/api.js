import $ from 'jquery';
import { Peer } from 'peerjs';
import { LobbyClient } from './lobby.js';
import { PeerSession } from './peer-session.js';
import {
  Update_Game,
  Reset_Game,
  load_history,
  CheckMate,
  Select_Square,
  addMessage,
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
let queued = false;
let lobbyConnected = false;
const lobbyUrl =
  import.meta.env.VITE_LOBBY_URL ||
  (import.meta.env.DEV ? 'ws://localhost:8787/lobby' : '');
const lobby = new LobbyClient(lobbyUrl, {
  onPlayers(peers) {
    socket.peers = Object.fromEntries(peers.map((peer) => [peer.id, peer]));
    queued = peers.find((peer) => peer.id === socket.peer.id)?.queued || false;
    if (!queued && lobbyConnected && !session.connection && !session.expected)
      $('#lobby-status').text('Connected');
    renderPlayers();
    updateFindButton();
  },
  onStatus(status) {
    lobbyConnected = status === 'Connected';
    if (!lobbyConnected) queued = false;
    $('#lobby-status').text(status);
    updateFindButton();
  },
  onError(text) {
    addMessage(text, 'Admin', { color: 'red' });
  },
  onMatch(match) {
    queued = false;
    if (!session.expect(match)) lobby.setBusy(Boolean(socket.opponent));
    $('#lobby-status').text(`Connecting to ${match.opponent.username}…`);
    updateFindButton();
  },
});

socket.peer = new Peer();
const session = new PeerSession(socket.peer, {
  getUsername: () => (socket.set_username ? socket.username : ''),
  onState(conn, accepted, color) {
    socket.opponent = conn;
    socket.get_accepted = accepted;
    socket.color = color;
    queued = false;
    const busy = Boolean(conn || session.expected);
    lobby.setBusy(busy);
    if (accepted) $('#lobby-status').text(`Playing ${conn.username}`);
    else if (!busy && lobbyConnected) $('#lobby-status').text('Connected');
    if (!conn || accepted) $('[dcr=request]').remove();
    $('.play').css({
      color: busy ? 'red' : '',
      cursor: busy ? 'not-allowed' : 'pointer',
    });
    $('#Resign').prop('disabled', busy && !accepted);
    updateFindButton();
    renderPlayers();
  },
  onStart() {
    Reset_Game();
    addMessage(
      `Playing ${socket.opponent.username}. You are ${socket.color === 'w' ? 'White' : 'Black'}.`,
      'Admin',
    );
  },
  onRequest: addRequest,
  onNotice: (text) => addMessage(text, 'Admin'),
  onData(data) {
    if (data.message === 'move') {
      const move = data.move;
      if (
        !move ||
        typeof move.piece?.src !== 'string' ||
        typeof move.dst !== 'string' ||
        !/^[0-7]-[0-7]$/.test(move.piece?.src) ||
        !/^[0-7]-[0-7]$/.test(move.dst) ||
        !['move', 'attack', 'ep', 'cs'].includes(move.type)
      )
        return;
      const piece = chess.get(move.piece.src);
      if (!piece || piece.color !== socket.opponent.color) return;
      const res = Update_Game({ piece, dst: move.dst, type: move.type }, true);
      if (res) Select_Square(`#b-${move.dst}`, 'green');
    } else if (
      data.message === 'message' &&
      typeof data.text === 'string' &&
      data.text.length <= 2000
    ) {
      addMessage(data.text, socket.opponent.username);
    } else if (
      data.message === 'load_history' &&
      Array.isArray(data.history) &&
      data.history.length <= 1000 &&
      data.history.every(
        (entry) =>
          entry?.move &&
          typeof entry.move.piece?.src === 'string' &&
          typeof entry.move.dst === 'string' &&
          /^[0-7]-[0-7]$/.test(entry.move.piece?.src) &&
          /^[0-7]-[0-7]$/.test(entry.move.dst) &&
          ['move', 'attack', 'ep', 'cs'].includes(entry.move.type),
      )
    ) {
      socket.history = data.history;
      addHistory(socket.opponent.username);
    } else if (data.message === 'deny_history') {
      addMessage('I want to start fresh...', socket.opponent.username);
    } else if (data.message === 'accept_history') {
      load_history(socket.history);
    } else if (data.message === 'checkmate' && chess.in_checkmate()) {
      CheckMate(chess.in_check().b ? 'w' : 'b');
    } else if (data.message === 'resign') {
      CheckMate(socket.color, 'Resign');
    } else if (data.message === 'reset') {
      Reset_Game();
      addMessage('Started a new game.', 'Admin');
    }
  },
});

socket.refreshLobby = () => {
  if (socket.peer.open && socket.set_username)
    lobby.connect(socket.peer.id, socket.username);
};
socket.leave = () => {
  if (socket.opponent?.open) socket.opponent.send({ message: 'leave' });
  session.leave();
};
socket.peer.on('open', () => {
  $('peers h4').css({ color: 'green' });
  socket.refreshLobby();
});
socket.peer.on('disconnected', () => {
  lobby.stop();
  lobbyConnected = false;
  queued = false;
  socket.peers = {};
  renderPlayers();
  updateFindButton();
  $('#lobby-status').text('Reconnecting to online play…');
  if (!socket.peer.destroyed) socket.peer.reconnect();
});
socket.peer.on('error', () => {
  addMessage(
    'Online connection failed. Local play is still available.',
    'Admin',
    { color: 'red' },
  );
});
socket.peer.on('close', () => {
  lobby.stop();
  lobbyConnected = false;
  queued = false;
  socket.peers = {};
  session.leave();
  $('#lobby-status').text('Online play disconnected.');
});
window.addEventListener('pagehide', () => {
  lobby.stop();
  socket.leave();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) socket.refreshLobby();
});

$('#find-opponent').on('click', () => {
  if (socket.opponent || session.expected || !socket.set_username) return;
  lobby.send({ type: queued ? 'cancel' : 'queue' });
});
function updateFindButton() {
  $('#find-opponent')
    .prop(
      'disabled',
      !lobbyConnected ||
        !socket.set_username ||
        Boolean(socket.opponent || session.expected),
    )
    .text(queued ? 'Cancel search' : 'Find opponent');
  if (queued) $('#lobby-status').text('Waiting for another player…');
}
function renderPlayers() {
  const ul = $('<ul>');
  for (const peer of Object.values(socket.peers)) {
    if (peer.id === socket.peer.id) continue;
    const li = $('<li>');
    const button = $('<button>', { type: 'button' }).text(
      `${peer.username}${peer.busy ? ' (Playing)' : ''}`,
    );
    button.prop(
      'disabled',
      peer.busy ||
        !socket.set_username ||
        Boolean(socket.opponent || session.expected) ||
        queued,
    );
    button.on('click', () => {
      if (
        session.request(peer.id, peer.username, Math.random() < 0.5 ? 'w' : 'b')
      ) {
        $('#lobby-status').text(`Waiting for ${peer.username} to accept…`);
        addMessage(`Sent a play request to ${peer.username}.`, 'Admin');
      }
    });
    ul.append(li.append(button));
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
    $('<button>', { type: 'button', class: 'btn-yes' })
      .text('✓')
      .on('click', accept),
    $('<button>', { type: 'button', class: 'btn-no' })
      .text('✕')
      .on('click', deny),
  );
  $('.chat-messages ul').append(li);
}
renderPlayers();
updateFindButton();
if (!lobbyUrl) $('#lobby-status').text('Online play is not configured.');

function addHistory(
  username,
  style = {
    color: 'blue',
  },
) {
  console.log('request for paly');
  const messageBox = $('.chat-messages');
  const ul = $('.chat-messages ul');
  const messageElement = $('<li>').html(`
      <b>Admin: </b>
      <span></span>
      <button class="btn-yes" name="yes">✓</button>
      <button class="btn-no" name="no">✕</button>
    `);
  messageElement.find('span').text(`${username} asks to load a game!`);
  messageElement.attr('dcr', 'load_history');
  messageElement.find('span').css(style);
  messageElement.find('.btn-yes').click(acceptHistory);
  messageElement.find('.btn-no').click(denyHistory);

  ul.append(messageElement);
  messageBox.scrollTop(messageBox.prop('scrollHeight'));
}

function acceptHistory() {
  console.log('acceptHistory');
  load_history(socket.history);

  socket.opponent.send({
    username: socket.username,
    id: socket.peer._id,
    message: 'accept_history',
    color: socket.color,
  });

  $('[dcr=load_history]').fadeOut(500, function () {
    $('[dcr=load_history]').remove();
  });
}

function denyHistory() {
  console.log('denyHistory');

  socket.opponent.send({
    username: socket.username,
    id: socket.peer._id,
    message: 'deny_history',
    color: socket.color,
  });

  $('[dcr=load_history]').fadeOut(500, function () {
    $('[dcr=load_history]').remove();
  });
}
