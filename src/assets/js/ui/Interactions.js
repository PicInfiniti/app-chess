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
    if (Move) {
      update_board();
      turn_update();
      socket.end_game = false;
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
          promotion: el.move.promotion,
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
  if (socket.opponent || socket.recovery?.active) return;
  try {
    const obj = JSON.parse(event.target.result);
    if (!Array.isArray(obj.move) || obj.move.length > 1024)
      throw new Error('Invalid history.');
    load_history(obj.move);
  } catch {
    addMessage('Unable to load this game history.', 'Admin', { color: 'red' });
  }
}

$('#jsonfile').change((event) => {
  var reader = new FileReader();
  reader.onload = onReaderLoad;
  if (event.target.files[0]) reader.readAsText(event.target.files[0]);
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

$('#board label').droppable({
  accept: '#board label img',
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
