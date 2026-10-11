import $ from 'jquery';
console.log('api');
import { Peer } from 'peerjs';

import {
  Update_Game,
  Reset_Game,
  load_history,
  CheckMate,
  Select_Square,
} from './ui/utils.js';
import { chess } from './ui/setup.js';

import { addMessage } from './ui/utils.js';

import Chance from 'chance';
var chance = new Chance();

// const serverUrl = "http://127.0.0.1:5000";
const serverUrl =
  import.meta.env.VITE_SERVER_URL || 'https://gungi.pythonanywhere.com';
export var socket = {};

socket = {
  peer: null, // your peer
  opponent: null,
  color: null, // your color in case have opponent
  username: '',
  set_username: false, // custom username used or not
  admin: true, // I don't where should I use it
  error: 0, // To stop printing same error multi time
  data: null, // keep last data received
  get_accepted: false, // play request accept or not
  history: [], // used to loading game
  click: true, // to allow clicking or not
  end_game: false, // keep if the game ends or not,
  click_pos: {
    // keep track of click positions
    src: null,
    dst: null,
  },
  playback: false,
};

document.socket = socket;
document.Reset_Game = Reset_Game;

socket.peer = new Peer();
socket.peer.on('open', function (id) {
  addMessage(`You are Online`, 'Admin');
  socket.error = 0;

  $('peers h4').css({
    color: 'green',
  });
  socket.username = id.slice(0, 8); // set default username

  sendHeartbeat(id); // send first heartbeat
  setInterval(() => {
    // send heartbeat every 5 seconds
    sendHeartbeat(id);
  }, 5000); // 5 seconds
});

socket.peer.on('connection', function (conn) {
  conn.on('data', function (data) {
    if (data.message == 'hi') {
      socket.data = data;
      addRequest(data.username);
    } else if (data.message == 'move') {
      let piece = chess.get(data.move.piece.src);
      let res = Update_Game(
        {
          piece: piece,
          dst: data.move.dst,
          type: data.move.type,
        },
        true,
      );

      if (res) {
        Select_Square(`#b-${data.move.dst}`, 'green');
      }
    } else if (data.message == 'message') {
      addMessage(data.text, data.username);
    } else if (data.message == 'close') {
      addMessage(`${socket.opponent.username} Leave the game.`, 'Admin');
    } else if (data.message == 'rejected') {
      socket.opponent = null;
      socket.get_accepted = false;

      addMessage('Maybe another time...', data.username);
    } else if (data.message == 'accepted') {
      addMessage("Let's Play", data.username);

      socket.get_accepted = true;

      Reset_Game();
    } else if (data.message == 'load_history') {
      socket.history = data.history;
      addHistory(data.username);
    } else if (data.message == 'deny_history') {
      addMessage('I want to start fresh...', data.username);
    } else if (data.message == 'accept_history') {
      addMessage(`${data.username} Loads a Game...`, 'Admin');
      load_history(socket.history);
    } else if (data.message == 'checkmate') {
      CheckMate(chess.in_check().b ? 'w' : 'b');
    } else if (data.message == 'resign') {
      CheckMate(data.color == 'w' ? 'b' : 'w', 'Resign');
    } else if (data.message == 'leave') {
      addMessage(`${data.username} Leaves The Game.`, 'Admin');
      socket.opponent = null;
    } else {
      console.log(data);
    }
  });
});

socket.peer.on('error', function () {
  if (socket.error === 0) {
    addMessage(`Some Error occurred`, 'Admin', {
      color: 'red',
    });
  }
});

socket.peer.on('disconnected', function () {
  if (socket.error === 0) {
    addMessage(`You are disconnected.`, 'Admin', {
      color: 'red',
    });
    socket.peer.reconnect();
    addMessage(`Reconnecting...`, 'Admin', {
      color: 'red',
    });
    $('peers h4').css({
      color: 'red',
    });
    socket.error = 1;
  }
});

socket.peer.on('close', function () {
  if (socket.opponent != null) {
    socket.opponent.send({
      username: socket.username,
      id: socket.peer._id,
      message: 'close',
      color: socket.color,
    });
  }
});

function sendHeartbeat(peerId) {
  // heartbeat function
  $.ajax({
    type: 'POST',
    url: `${serverUrl}/heartbeat_chess`,
    contentType: 'application/json',
    data: JSON.stringify({
      id: peerId,
      username: socket.username,
      opponent:
        socket.opponent === null
          ? {}
          : {
              id: socket.opponent.id,
              username: socket.opponent.username,
            },
    }),

    success: function (data) {
      socket.peers = data.active_peers;

      $('peers ul').remove();
      var ul = $('<ul>');
      var $peers = $('peers'); // Select the div by its id

      for (let peer in socket.peers) {
        if (peer != socket.peer._id) {
          if (socket.peers[peer].opponent.username === undefined) {
            const li = $('<li>').text(`${socket.peers[peer].username}`); // Create a new <li> element with the text
            li.css({
              cursor: 'pointer',
            });
            ul.append(li); // Append the <li> element to the <ul>
            $peers.append(ul); // Append the <ul> to the div
            li.attr('id', peer).click(function () {
              if (socket.opponent === null && socket.set_username) {
                socket.opponent = socket.peer.connect(this.id);
                socket.opponent.id = this.id;
                socket.color = chance.pickone(['b', 'w']);
                socket.opponent.color = socket.color == 'b' ? 'w' : 'b';
                socket.opponent.username = socket.peers[peer].username;
                socket.opponent.on('open', function () {
                  socket.opponent.send({
                    username: socket.username,
                    id: socket.peer._id,
                    message: 'hi',
                    color: socket.color,
                  });
                  console.log('send hi');
                  addMessage(`Send request to ${li.text()}`, 'Admin', {
                    color: 'green',
                  });
                  $('.play').css({ color: 'red', cursor: 'not-allowed' });
                });

                socket.opponent.on('error', function () {
                  addMessage(
                    `Some Error occurred from your ${socket.opponent.username} side`,
                    'Admin',
                    {
                      color: 'red',
                    },
                  );
                });

                socket.opponent.on('close', function () {
                  addMessage(
                    `${socket.opponent.username} lost connection or may leave the game. You can save the game for future playing.`,
                    'Admin',
                    {
                      color: 'orange',
                    },
                  );
                  socket.opponent = null;
                  socket.get_accepted = false;
                });
              } else if (socket.set_username) {
                addMessage(`You are playing`, 'Admin');
              }
            });
          } else {
            const li = $('<li>').text(
              `${socket.peers[peer].username} (Playing)`,
            ); // Create a new <li> element with the text
            li.css({
              cursor: 'not-allowed',
              opacity: '.8',
            });
            ul.append(li); // Append the <li> element to the <ul>
            $peers.append(ul); // Append the <ul> to the div
          }
        } else {
          if (socket.opponent === null) {
            let div = $('peers peer').html(`. ${socket.peers[peer].username}`); // Create a new <li> element with the text
            let label = $('<label>').text('♔');
            div.prepend(label);
          } else if (socket.color === 'w' && socket.get_accepted) {
            let label = $("<label dcr='w'>").text('♔');
            let div = $('peers peer').html(` ${socket.peers[peer].username}`); // Create a new <li> element with the text
            div.prepend(label);
          } else if (socket.color === 'b' && socket.get_accepted) {
            let label = $("<label dcr='b'>").text('♔');
            let div = $('peers peer').html(` ${socket.peers[peer].username}`); // Create a new <li> element with the text
            div.prepend(label);
          }
        }
      }
    },
    error: function () {
      console.error('Error sending peer ID.');
    },
  });
}

function addRequest(
  username,
  style = {
    color: 'blue',
  },
) {
  console.log('request for paly');
  const messageBox = $('.chat-messages');
  const ul = $('.chat-messages ul');
  const messageElement = $('<li>').html(`
      <b>${username}: </b>
      <span>Do you want to play?</span>
      <button class="btn-yes" name="yes">✓</button>
      <button class="btn-no" name="no">✕</button>
    `);
  messageElement.attr('dcr', 'request');
  messageElement.find('span').css(style);
  messageElement.find('.btn-yes').click(accept);
  messageElement.find('.btn-no').click(deny);

  ul.append(messageElement);
  messageBox.scrollTop(messageBox.prop('scrollHeight'));
}

function accept() {
  console.log('accepted');
  Reset_Game();
  if (socket.opponent === null) {
    socket.opponent = socket.peer.connect(socket.data.id);
    socket.opponent.color = socket.data.color;
    socket.color = socket.opponent.color == 'b' ? 'w' : 'b';
    socket.opponent.id = socket.data.id;
    socket.opponent.username = socket.data.username;

    socket.opponent.on('open', function () {
      socket.opponent.send({
        username: socket.username,
        id: socket.peer._id,
        message: 'accepted',
        color: socket.color,
      });
    });
    $('.play').css({ color: 'red', cursor: 'not-allowed' });
    socket.get_accepted = true;
  }
  $('[dcr=request]').fadeOut(500, function () {
    $('[dcr=request]').remove();
  });
}

function deny() {
  console.log('rejected');
  let opponent = socket.peer.connect(socket.data.id);
  opponent.on('open', function () {
    opponent.send({
      username: socket.username,
      id: socket.peer._id,
      message: 'rejected',
      color: socket.color,
    });
  });

  $('[dcr=request]').fadeOut(500, function () {
    $('[dcr=request]').remove();
  });
}

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
      <span>${username} asks to load a game! </span>
      <button class="btn-yes" name="yes">✓</button>
      <button class="btn-no" name="no">✕</button>
    `);
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
