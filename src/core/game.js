import $ from 'jquery';
// libraries +++++++++++++++++++++++++++++++++++++
console.log('main');
import 'unicode-emoji-picker';
import { socket } from '../assets/js/api.js';
import { addMessage, Reset_Game, update_board } from '../assets/js/ui/utils.js';
// libraries -------------------------------------

// sass ++++++++++++++++++++++++++++++++++++++++++

// sass ------------------------------------------

update_board();

// setup +++++++++++++++++++++++++++++++++++++++++
document.addEventListener('contextmenu', (event) => event.preventDefault());

function capitalizeFirstLetter(string) {
  let temp = string.charAt(0).toUpperCase() + string.slice(1);
  return temp.replace('_', ' ');
}

$('.stockpile').hover(
  (event) => {
    let color = $(event.target).attr('id')[0];
    if (color == 'b') {
      $('#black_stockpile .army .tooltip')
        .show()
        .text(capitalizeFirstLetter(event.target.getAttribute('dcr')));
    } else {
      $('#white_stockpile .army .tooltip')
        .show()
        .text(capitalizeFirstLetter(event.target.getAttribute('dcr')));
    }
  },
  () => {
    $('.tooltip').hide().text('King');
  },
);

$('#tower').hover(
  (event) => {
    $('#black_stockpile .army .tooltip')
      .show()
      .text(capitalizeFirstLetter(event.target.getAttribute('dcr')));
  },
  () => {
    $('.tooltip').hide().text('King');
  },
);
// setup -----------------------------------------

// Ui ++++++++++++++++++++++++++++++++++++++
import '../assets/js/ui/Interactions.js';

// Ui -------------------------------------------
//API ++++++++++++++++++++++++++++++++
import '../assets/js/api.js';
// ---------------------------------

let $nav = $('#status #PHASE setting');

$nav.on('click', function () {
  if ($('nav').width() != 0) {
    $('nav').width('0');
  } else {
    $('nav').width('250px');
  }
});

let $close = $('.closebtn');
$close.on('click', function closeNav() {
  $('nav').width('0');
});

$('.usernameInput').focus();
const cleanInput = (input) => {
  return $('<div/>').text(input).html();
};
const setUsername = () => {
  let username = cleanInput($('.usernameInput').val().trim());
  socket.username = username;
  socket.set_username = true;
};

$('.usernameInput').keyup(function (event) {
  if (event.which == 13) {
    setUsername();
    $('.form').fadeOut(1000, function () {
      $('.chat-messages ul').show();
      $('.form').remove();
      $('.chat-messages').css({
        'background-color': 'white',
        color: 'black',
        'text-align': 'left',
        display: 'block',
      });
    });
    $('.chat-messages').css({
      'background-color': 'white',
    });
  }
});

// chat box
function sendMessage() {
  const messageInput = document.getElementById('message-input');
  const messageText = messageInput.value.trim();

  if (socket.set_username) {
    addMessage(messageText, socket.username);

    if (socket.opponent) {
      socket.opponent.send({
        message: 'message',
        text: messageText,
        username: socket.username,
      });
    }
  }
  messageInput.value = '';
}

const messageInput = document.getElementById('message-input');
$('.chat-send').click(function () {
  sendMessage();
});

messageInput.addEventListener('keydown', function (event) {
  if (event.keyCode === 13) {
    // 13 is the Enter key code
    sendMessage();
  }
});

$('.emoji-button').click(function () {
  $('unicode-emoji-picker').toggle();
});

const emojiPicker = document.querySelector('unicode-emoji-picker');
emojiPicker.addEventListener('emoji-pick', (event) => {
  $('.chat-input').val($('.chat-input').val() + event.detail.emoji);
});

$('#new_game').click(function () {
  Reset_Game();
  addMessage('Reset The Game...', 'Admin');
});

$('#leave_game').click(function () {
  if (socket.opponent != null) {
    addMessage(`${socket.username} Leaves The Game.`, 'Admin');
    socket.opponent.send({
      username: socket.username,
      id: socket.peer._id,
      message: 'leave',
      color: socket.color,
    });

    socket.opponent = null;
  }
});

$('.chat-box').draggable();

$('.chat-box').resizable({
  maxWidth: 1000,
  minWidth: 500,
  aspectRatio: 5 / 3,
  handles: 'ne, n, e, s, w, sw, nw',
  resize: function (event, ui) {
    $('.chat-messages').css({
      height: `${ui.size.height - 50}px`,
    });

    $('.chat-box .form h3').css('font-size', `${ui.size.width / 25}pt`);
    $('.chat-box .form .usernameInput').css(
      'font-size',
      `${ui.size.width / 33}pt`,
    );
    console.log(
      $('.chat-box .form h3').css('font-size'),
      $('.chat-box .form .usernameInput').css('font-size'),
    );
  },
});
