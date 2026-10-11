import $ from 'jquery';
// libraries +++++++++++++++++++++++++++++++++++++
console.log('interaction');

// libraries -------------------------------------

import {
  Reset_Sections,
  Select_Square,
  Show_Moves,
  Movement_Possibility,
  Update_Game,
  Check,
  CheckMate,
  saveText,
  load_history,
  update_board,
  addMessage,
  turn_update,
  Move_piece,
} from './utils.js';

import { chess } from './setup.js';

import { socket } from '../api.js';

$('#result').click(function () {
  Reset_Sections();
});

$('#Resign').click(function () {
  Reset_Sections();
  if (chess.in_check()['b'] || chess.in_check()['w']) {
    Check(chess.in_check()['b'] ? 'b' : 'w');
    Check(chess.in_check()['w'] ? 'w' : 'b');
  }

  if (socket.opponent != null) {
    CheckMate(socket.color == 'w' ? 'b' : 'w', 'Resign');
  } else {
    CheckMate(chess.turn == 'w' ? 'b' : 'w', 'Resign');
  }

  socket.click = false;

  socket.click_pos = {
    src: null,
    dst: null,
  };

  if (chess.in_checkmate() && $('#r-2').css('opacity') != 0.6) {
    CheckMate(chess.in_check().b ? 'w' : 'b');
  }
});

$('#playGame').click(function () {
  load_history(chess.history);
});

$('.play').click(function () {
  if (
    chess.history.length < socket.history.length &&
    socket.opponent === null
  ) {
    if (!socket.playback) {
      PlayBack();
    }
    socket.playback = socket.playback ? false : true;
    socket.click = socket.click ? false : true;
  }
});

$('.undo').click(function () {
  if (chess.count > 0 && socket.opponent == null) {
    socket.playback = socket.playback ? false : true;
    let Move = chess.undo();
    let d_x = Number(Move.dst[0]);
    let d_y = Number(Move.dst[2]);
    turn_update();
    Move_piece(Move.dst, Move.piece.src, update_board);
    if (Move.type == 'cs') {
      Move_piece(
        `${d_x}-${d_y == 6 ? 5 : 3}`,
        `${d_x}-${d_y == 6 ? 7 : 0}`,
        update_board,
      );
    }
  }
});

function PlayBack() {
  $('.redo').click();
  setTimeout(() => {
    if (socket.playback) {
      PlayBack();
    }
  }, 500);
}

$('.redo').click(function () {
  if (chess.history.length < socket.history.length && socket.opponent == null) {
    let el = socket.history[chess.count];
    if (el) {
      let piece = chess.get(el.move.piece.src);
      Update_Game(
        {
          piece: piece,
          dst: el.move.dst,
          type: el.move.type,
        },
        false,
        true,
      );
    }
  }
});

$('#save').click(function () {
  saveText(
    JSON.stringify({
      move: chess.history,
    }),
    'history.json',
  );
});

// read json ----------------------

function onReaderLoad(event) {
  var obj = JSON.parse(event.target.result);
  socket.history = obj.move;
  if (socket.opponent === null) {
    if (!socket.playback) {
      PlayBack();
    }
    socket.playback = socket.playback ? false : true;
    socket.click = socket.click ? false : true;
  } else {
    socket.opponent.send({
      username: socket.username,
      id: socket.peer._id,
      message: 'load_history',
      history: socket.history,
      color: socket.color,
    });
  }
}

$('#jsonfile').change((event) => {
  var reader = new FileReader();
  reader.onload = onReaderLoad;
  reader.readAsText(event.target.files[0]);
});

// ---------------------------------------

$('#board label').mousedown(function (event) {
  Reset_Sections();
  let piece = chess.get($(this).attr('name'));
  let pieceMoves = [];

  if (piece == null && socket.click_pos.src == null) {
    socket.click_pos.dst = null;
  }

  if (piece == null && socket.click_pos.src != null) {
    socket.click_pos.dst = $(this).attr('name');
    pieceMoves = Movement_Possibility(
      socket.click_pos.src,
      socket.click_pos.dst,
    );
    if (pieceMoves.length == 0) {
      socket.click_pos.src = null;
      socket.click_pos.dst = null;
    }
  }

  if (piece != null && socket.click_pos.src == null) {
    socket.click_pos.src = $(this).attr('name');
  } else if (piece != null && socket.click_pos.src != null) {
    socket.click_pos.dst = $(this).attr('name');
    pieceMoves = Movement_Possibility(
      socket.click_pos.src,
      socket.click_pos.dst,
    );

    if (pieceMoves.length == 0) {
      socket.click_pos.src = socket.click_pos.dst;
      socket.click_pos.dst = null;
    }
  }

  if (!chess.in_checkmate()) {
    switch (event.which) {
      case 1: // grab left click
        Select_Square(this, 'green');
        if (socket.click) {
          Show_Moves(chess, $(this).attr('name'), socket.click_pos);
          if (pieceMoves.length == 1) {
            let res = Update_Game({
              piece: chess.get(socket.click_pos.src),
              dst: socket.click_pos.dst,
              type: pieceMoves[0].type,
            });
            if (res) {
              socket.history = JSON.parse(JSON.stringify(chess.history));
            }

            if (
              res &&
              res.piece.name == 'pawn' &&
              (res.dst[0] == 0 || res.dst[0] == 7)
            ) {
              addPromotion('Admin', res);
            }

            socket.click_pos.src = null;
            socket.click_pos.dst = null;
          }
        }
        // --------------------------------------------------------
        break;

      default:
        console.log('You have a strange Mouse!');
        break;
    }
  }

  if (chess.in_check()['b'] || chess.in_check()['w']) {
    Check(chess.in_check()['b'] ? 'b' : 'w');
    Check(chess.in_check()['w'] ? 'w' : 'b');
  }

  if (chess.in_checkmate() && socket.end_game == false) {
    CheckMate(chess.in_check().b ? 'w' : 'b');
  }
});

function addPromotion(username, res) {
  console.log('request for paly');
  const messageBox = $('.chat-messages');
  const ul = $('.chat-messages ul');
  const messageElement = $('<li>').html(`
      <b>Admin: </b>
      <span>Which promotion you want?</span>
      <button class="promotion" name="queen">♛</button>
      <button class="promotion" name="bishop">♝</button>
      <button class="promotion" name="knight">♞</button>
      <button class="promotion" name="rook">♜</button>
    `);
  messageElement.attr('dcr', 'promotion');
  messageElement.find('.promotion').click(acceptPromotion.bind(null, res));

  ul.append(messageElement);
  messageBox.scrollTop(messageBox.prop('scrollHeight'));
}

function acceptPromotion(res, e) {
  console.log(e, res);
  res.piece.Promotion(e.target.name);
  update_board();

  $('[dcr=promotion]').fadeOut(500, function () {
    $('[dcr=promotion]').remove();
  });
}

$('#board label').droppable({
  accept: '#board label span ',
  drop: function (event, ui) {
    socket.click_pos.src = ui.draggable.parent().attr('name');
    socket.click_pos.dst = $(this).attr('name');
    let piece = chess.get(socket.click_pos.src);

    if (piece.color != chess.turn) {
      addMessage('Not Your Turn!!!', 'Admin');
    }

    let pieceMoves = Movement_Possibility(
      socket.click_pos.src,
      socket.click_pos.dst,
    );

    if (!chess.in_checkmate()) {
      switch (event.which) {
        case 1: // grab left click
          Reset_Sections();
          if (socket.click) {
            Show_Moves(chess, $(this).attr('name'), socket.click_pos);
            if (pieceMoves.length == 1) {
              let res = Update_Game({
                piece: chess.get(socket.click_pos.src),
                dst: socket.click_pos.dst,
                type: pieceMoves[0].type,
              });

              if (!res) {
                ui.helper.animate(ui.originalPosition);
              } else {
                socket.history = JSON.parse(JSON.stringify(chess.history));
              }

              if (
                res &&
                res.piece.name == 'pawn' &&
                (res.dst[0] == 0 || res.dst[0] == 7)
              ) {
                addPromotion('Admin', res);
              }

              socket.click_pos.src = null;
              socket.click_pos.dst = null;
            }
          }
          // --------------------------------------------------------
          break;

        default:
          console.log('You have a strange Mouse!');
          break;
      }
    }

    if (chess.in_check()['b'] || chess.in_check()['w']) {
      Check(chess.in_check()['b'] ? 'b' : 'w');
      Check(chess.in_check()['w'] ? 'w' : 'b');
    }

    if (chess.in_checkmate() && socket.end_game == false) {
      CheckMate(chess.in_check().b ? 'w' : 'b');
    }
  },
});
