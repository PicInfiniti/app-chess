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

function move(desk, src, dst, promotion) {
  const candidate = desk.moves(desk.get(src)).find((m) => m.dst === dst);
  return candidate && desk.move({ ...candidate, promotion });
}

test('castling is forbidden from check and through an attacked square', () => {
  for (const fen of [
    '4r1k1/8/8/8/8/8/8/4K2R w K - 0 1',
    '5rk1/8/8/8/8/8/8/4K2R w K - 0 1',
  ]) {
    const desk = new Desk(fen);
    assert.equal(
      desk.moves(desk.get('7-4')).some((m) => m.type === 'cs'),
      false,
    );
  }
  const desk = new Desk('6k1/8/8/8/8/8/8/4K2R w K - 0 1');
  assert.ok(move(desk, '7-4', '7-6'));
  assert.equal(desk.get('7-5').name, 'rook');
  desk.undo();
  assert.equal(desk.get('7-7').name, 'rook');
});

test('underpromotion is part of the move and undo restores the pawn', () => {
  const desk = new Desk('7k/P7/8/8/8/8/8/7K w - - 0 1');
  assert.equal(desk.moves(desk.get('1-0')).length, 1);
  assert.equal(move(desk, '1-0', '0-0'), null);
  assert.ok(move(desk, '1-0', '0-0', 'n'));
  assert.equal(desk.get('0-0').name, 'knight');
  assert.equal(desk.history[0].move.promotion, 'n');
  desk.undo();
  assert.equal(desk.get('1-0').name, 'pawn');
});

test('compact recovery replays en passant, castling rights, and every move', () => {
  const desk = new Desk();
  for (const [src, dst] of [
    ['6-4', '4-4'],
    ['1-0', '2-0'],
    ['4-4', '3-4'],
    ['1-3', '3-3'],
    ['3-4', '2-3'],
  ])
    assert.ok(move(desk, src, dst));
  const saved = desk.checkpoint();
  const recovered = new Desk();
  recovered.restore(saved);
  assert.equal(recovered.get('3-3'), null);
  assert.equal(recovered.get('2-3').color, 'w');
  assert.deepEqual(recovered.checkpoint(), saved);
  assert.throws(() =>
    recovered.restore({ ...saved, fen: new Desk().engine.fen() }),
  );
  assert.throws(() => recovered.restore({ moves: ['e2e5'], fen: saved.fen }));
  assert.deepEqual(recovered.checkpoint(), saved);
});

test('promotion choices survive compact replay from the starting position', () => {
  const desk = new Desk();
  for (const uci of [
    'a2a4',
    'h7h5',
    'a4a5',
    'h5h4',
    'a5a6',
    'h4h3',
    'a6b7',
    'h3g2',
    'b7a8n',
  ]) {
    const src = `${8 - Number(uci[1])}-${'abcdefgh'.indexOf(uci[0])}`;
    const dst = `${8 - Number(uci[3])}-${'abcdefgh'.indexOf(uci[2])}`;
    assert.ok(move(desk, src, dst, uci[4]));
  }
  const restored = new Desk();
  restored.restore(desk.checkpoint());
  assert.equal(restored.get('0-0').name, 'knight');
  assert.equal(restored.history.at(-1).move.promotion, 'n');
  restored.undo();
  assert.equal(restored.get('1-1').name, 'pawn');
});
