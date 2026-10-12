import $ from 'jquery';
// libraries +++++++++++++++++++++++++++++++++++++
console.log('util');

// libraries -------------------------------------

import { chess } from './setup.js';
import { socket } from '../api.js';

export function addMessage(
  text,
  username,
  style = {
    color: 'blue',
  },
) {
  if (text !== '') {
    console.log(`log: ${text}`);
    const messageBox = $('.chat-messages');
    const ul = $('.chat-messages ul');
    const messageElement = $('<li>').append(
      $('<b>').text(`${username}: `),
      $('<span>').text(text),
    );
    messageElement.find('span').css(style);

    ul.append(messageElement);
    messageBox.scrollTop(messageBox.prop('scrollHeight'));
  }
}

export function Check(color) {
  let piece = chess.kings[color];
  $('#b-' + piece.src).css({
    border: '2px solid red',
    'box-shadow': '0px 0px 10px min(.3vh,.3vw) red',
    color: 'red',
  }); // change color of current box
}

export function CheckMate(color, type = 'CheckMate') {
  if (socket.end_game === false) {
    if (socket.opponent != null && !socket.recovery?.active) {
      addMessage(
        `${socket.color == color ? socket.username : socket.opponent.username} 🎊🎊WINS🎉🎉 with a ${type} against ${socket.color == color ? socket.opponent.username : socket.username}.`,
        'Admin',
      );
      socket.opponent.send({
        username: socket.username,
        id: socket.peer._id,
        message: type == 'CheckMate' ? 'checkmate' : 'resign',
        color: socket.color,
      });
    } else {
      addMessage(
        `${color == 'b' ? 'Black' : 'White'} 🎊🎊WINS🎉🎉 with a ${type} against ${color == 'w' ? 'Black' : 'White'}.`,
        'Admin',
        {
          color: 'green',
        },
      );
    }

    if (color == 'b') {
      $('#r-2 span').text('Black');
      $('#r-1').css({
        outline: '30px #171716 solid',
      });
    } else {
      $('#r-2 span').text('White');
      $('#r-1').css({
        outline: '30px #d1d1d1 solid',
      });
    }
    $('#result').css({
      'z-index': 3,
      opacity: 1,
    });
    socket.end_game = true;
  }
}

export function load_history(history) {
  Reset_Game();
  for (const el of history) {
    if (
      !Update_Game(
        {
          piece: chess.get(el.move.piece.src),
          dst: el.move.dst,
          type: el.move.type,
          promotion: el.move.promotion,
        },
        false,
        true,
      )
    ) {
      Reset_Game();
      throw new Error('This history contains an illegal move.');
    }
  }
  socket.history = structuredClone(chess.history);
}

export function Move(message) {
  let piece = chess.get(message.piece.src);
  Update_Game({
    piece: piece,
    dst: message.dst,
    type: message.type,
  });
}

export function Move_piece(src, dst, callback = function () {}) {
  socket.click = false;
  let s_x = Number(src[0]);
  let s_y = Number(src[2]);
  let d_x = Number(dst[0]);
  let d_y = Number(dst[2]);

  let $src = $(`#b-${s_x}-${s_y} img`);
  let $dst = $(`#b-${d_x}-${d_y}`);

  if ($src) {
    var targetTop = `${(d_x - s_x) * 100}px`;
    var targetLeft = `${(d_y - s_y) * 100}px`;

    $src.animate(
      {
        top: targetTop,
        left: targetLeft,
      },
      400,
      function () {
        $src.appendTo($dst);
        $src.css({
          top: '',
          left: '',
        });
        socket.click = true;
        callback();
      },
    );
  }
}

export function Movement_Possibility(src, dst) {
  let piece = chess.get(src);
  let Possibility = chess.moves(piece);
  return Possibility.filter((move) => move.dst == dst);
}

export function Put_Pieces(e, name, color) {
  let $img = getSvg(name, color);
  $img.draggable({
    revert: true,
    revertDuration: 300,
  });

  $(e).append($img);
}

export function Reset_Sections() {
  for (let item of $('#board label')) {
    let box = $(item).attr('name');
    let x = Number(box[0]);
    let y = Number(box[2]);
    $(item).css({
      border: '',
      'box-shadow': '',
      'background-color': (x + y) % 2 == 0 ? '#ffba75' : '#EB9E53',
    }); // change color of all boxes
  }

  if ($('#result').css('opacity') == 1) {
    $('#r-0').css({
      opacity: 0.6,
      'background-color': 'transparent',
    });
    $('#r-1').css({
      opacity: 0.6,
    });
    $('#r-2').css({
      opacity: 0.6,
    });
    $('#result').css({
      'z-index': 3,
      opacity: 1,
    });
  }
}

export function saveText(text, filename) {
  var a = document.createElement('a');
  a.setAttribute(
    'href',
    'data:text/plain;charset=utf-8,' + encodeURIComponent(text),
  );
  a.setAttribute('download', filename);
  a.click();
}

export function turn_update() {
  if (chess.turn == 'b') {
    $('#PB').css({
      'box-shadow': '0px 0px 15px 12px #ad00ad',
    });
    $('#PW').css({
      'box-shadow': '0px 0px 0px 0px #d1d1d1',
    });
  } else {
    $('#PW').css({
      'box-shadow': '0px 0px 15px 12px #ad00ad',
    });
    $('#PB').css({
      'box-shadow': '0px 0px 0px 0px #d1d1d1',
    });
  }
}

export function Select_Square(e, color) {
  Reset_Sections();
  $(e).css({
    border: `.2vh solid ${color}`,
    'box-shadow': `0px 0px 10px 2px ${color}`,
    'background-color': `${color}`,
  }); // change color of current box
}

export function Show_Moves(chess, tag) {
  let Moves = chess.moves(chess.get(tag));
  if (Moves.length > 0) {
    $.each(Moves, function (_, item) {
      if (item.type == 'move') {
        $('#b-' + item.dst).css({
          border: '2px solid #009699',
          'box-shadow': '0px 0px 10px 2px #009699',
          'background-color': '#009699',
        });
      } else if (item.type == 'attack') {
        $('#b-' + item.dst).css({
          border: '2px solid red',
          'box-shadow': '0px 0px 10px 2px red',
          'background-color': 'red',
        });
      } else {
        $('#b-' + item.dst).css({
          border: '2px solid orange',
          'box-shadow': '0px 0px 10px 2px orange',
          'background-color': 'orange',
        });
      }
    });
  }
}

export function update_board() {
  chess.board.forEach((row, x) => {
    row.forEach((piece, y) => {
      $(`#b-${x}-${y} img`).remove();
      if (piece) {
        Put_Pieces(`#b-${x}-${y}`, piece.name, piece.color);
      }
    });
  });

  if (chess.in_check()[chess.turn]) {
    Check(chess.turn);
  }
}

export function Update_Game(
  Move = {
    piece: null,
    dst: null,
    type: 'move',
  },
  admin = false,
  history = false,
) {
  if (
    (!socket.opponent || socket.get_accepted || history) &&
    (socket.opponent === null ||
      admin ||
      socket.color === chess.turn ||
      history)
  ) {
    if (
      !history &&
      !admin &&
      (socket.end_game ||
        !socket.click ||
        (socket.recovery?.active && !socket.recovery.canMove()))
    )
      return null;
    const legal = chess.moves(Move.piece).find((m) => m.dst === Move.dst);
    if (legal?.promotions && !Move.promotion && !admin && !history) {
      socket.click = false;
      const li = $('<li>').attr('dcr', 'promotion').text('Promote to: ');
      for (const [promotion, name] of [
        ['q', 'Queen'],
        ['r', 'Rook'],
        ['b', 'Bishop'],
        ['n', 'Knight'],
      ]) {
        li.append(
          $('<button>', { type: 'button' })
            .text(name)
            .on('click', () => {
              li.remove();
              socket.click = true;
              Update_Game({ ...Move, promotion });
            }),
        );
      }
      $('.chat-messages ul').append(li);
      return null;
    }
    const res = chess.move(Move);
    if (res) {
      update_board();
      turn_update();
      if (!history) socket.history = structuredClone(chess.history);
      if (!admin && !history && socket.opponent) {
        const lastMove = chess.history.at(-1);
        if (socket.recovery?.active)
          socket.recovery.propose(chess.checkpoint());
        else socket.opponent.send({ ...lastMove, message: 'move' });
      }
      if (!history && chess.in_checkmate())
        CheckMate(chess.turn === 'w' ? 'b' : 'w');
      else if (!history && chess.in_draw()) {
        socket.end_game = true;
        addMessage('Game drawn.', 'Admin');
      }
    }
    return res;
  }
}

export function Reset_Game() {
  chess.reset();
  update_board();
  turn_update();
  Reset_Sections();

  document.getElementById('jsonfile').value = null;

  $('#result').css({
    'z-index': 0,
    opacity: 0,
  });

  socket.history = [];
  socket.click = true;
  socket.end_game = false;
  ((socket.click_pos = {
    src: null,
    dst: null,
  }),
    (socket.playback = false));
}

document.update_board = update_board;

function getSvg(name, color) {
  const src = new URL(`../../pieces/${name}-${color}.svg`, import.meta.url)
    .href;
  return $('<img>', {
    src: src,
    alt: `${color} ${name}`,
    class: 'chess-piece', // Optional class for styling
  });
}
