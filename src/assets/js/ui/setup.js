import $ from 'jquery';
// libraries +++++++++++++++++++++++++++++++++++++
console.log('setup');
// libraries -------------------------------------

import Desk from '../lib/desk.js';

export const chess = new Desk();
document.chess = chess;

for (let i = 0; i < 8; i++) {
  for (let j = 0; j < 8; j++) {
    if ((i + j) % 2 == 0) {
      $('#board').append(
        `<label type='text' id='b-${i}-${j}' name='${i}-${j}' style='background-color: #ffba75'></label>`,
      );
    } else {
      $('#board').append(
        `<label type='text' id='b-${i}-${j}' name='${i}-${j}' style='background-color: #EB9E53'></label>`,
      );
    }
  }
}
let alphabet = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
for (let i = 0; i < 8; i++) {
  $('arena .top').append(`<div><b>${alphabet[i]}</b></div>`);
  $('arena .bottom').append(`<div><b>${alphabet[i]}</b></div>`);
  $('arena .right').append(`<div><b>${8 - i}</b></div>`);
  $('arena .left').append(`<div><b>${8 - i}</b></div>`);
}
