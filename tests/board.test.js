import assert from 'node:assert/strict';
import test from 'node:test';
import Desk from '../src/assets/js/lib/desk.js';

test('accepting a new match resets all board representations and legal moves', () => {
  const desk = new Desk();
  desk.move({ piece: desk.get('6-4'), dst: '4-4', type: 'move' });
  desk.reset();
  assert.equal(desk.board_1D.length, 32);
  assert.equal(desk.in_stalemate(), false);
  assert.equal(desk.in_checkmate(), false);
  assert.equal(desk.moves(desk.get('6-4')).length, 2);
  assert.ok(desk.move({ piece: desk.get('6-4'), dst: '4-4', type: 'move' }));
  assert.equal(desk.board_1D.length, 32);
});
