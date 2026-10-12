import { Chess, DEFAULT_POSITION } from 'chess.js';

const names = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};
const symbols = { w: '♙♘♗♖♕♔', b: '♟♞♝♜♛♚' };
const types = 'pnbrqk';
export const square = (pos) =>
  /^[0-7]-[0-7]$/.test(pos)
    ? `${'abcdefgh'[Number(pos[2])]}${8 - Number(pos[0])}`
    : null;
export const position = (sq) =>
  `${8 - Number(sq[1])}-${'abcdefgh'.indexOf(sq[0])}`;
const moveType = (move) =>
  move.flags.includes('e')
    ? 'ep'
    : /[kq]/.test(move.flags)
      ? 'cs'
      : move.captured
        ? 'attack'
        : 'move';

// Adapter for the existing board UI. The engine owns all rule state, including
// castling rights, en passant, repetition, and promotion.
export default class Desk {
  constructor(fen = DEFAULT_POSITION) {
    this.reset(fen);
  }
  reset(fen = DEFAULT_POSITION) {
    this.engine = new Chess(fen);
    this.initialFen = fen;
    this.history = [];
    this.sync();
  }
  sync() {
    this.board = this.engine.board().map((row) =>
      row.map((p) =>
        p
          ? {
              name: names[p.type],
              color: p.color,
              src: position(p.square),
              symbol: symbols[p.color][types.indexOf(p.type)],
            }
          : null,
      ),
    );
    this.board_1D = this.board.flat().filter(Boolean);
    this.kings = Object.fromEntries(
      this.board_1D.filter((p) => p.name === 'king').map((p) => [p.color, p]),
    );
    this.turn = this.engine.turn();
    this.count = this.history.length;
  }
  get(pos) {
    return square(pos) ? this.board[Number(pos[0])][Number(pos[2])] : null;
  }
  moves(piece) {
    if (!piece || this.get(piece.src) !== piece || piece.color !== this.turn)
      return [];
    const seen = new Set();
    return this.engine
      .moves({ square: square(piece.src), verbose: true })
      .filter((m) => {
        if (seen.has(m.to)) return false;
        seen.add(m.to);
        return true;
      })
      .map((m) => ({
        piece,
        dst: position(m.to),
        type: moveType(m),
        ...(m.promotion ? { promotions: ['q', 'r', 'b', 'n'] } : {}),
      }));
  }
  move({ piece, dst, type, promotion }) {
    const legal = this.moves(piece).find(
      (m) => m.dst === dst && m.type === type,
    );
    if (!legal || (legal.promotions && !legal.promotions.includes(promotion)))
      return null;
    try {
      this.engine.move({
        from: square(piece.src),
        to: square(dst),
        ...(promotion ? { promotion } : {}),
      });
    } catch {
      return null;
    }
    this.history.push({
      Num: this.history.length,
      move: {
        piece: { ...piece },
        dst,
        type,
        ...(promotion ? { promotion } : {}),
      },
    });
    this.sync();
    return { piece: this.get(dst), dst, type };
  }
  undo() {
    if (!this.engine.undo()) return null;
    const move = this.history.pop().move;
    this.sync();
    return move;
  }
  in_check() {
    return {
      w: this.turn === 'w' && this.engine.isCheck(),
      b: this.turn === 'b' && this.engine.isCheck(),
    };
  }
  in_checkmate() {
    return this.engine.isCheckmate();
  }
  in_stalemate() {
    return this.engine.isStalemate();
  }
  in_draw() {
    return this.engine.isDraw();
  }
  checkpoint() {
    return {
      moves: this.engine
        .history({ verbose: true })
        .map((m) => m.from + m.to + (m.promotion || '')),
      fen: this.engine.fen(),
    };
  }
  restore(state) {
    const restored = new Desk();
    if (!Array.isArray(state.moves) || state.moves.length > 1024)
      throw new Error('Invalid saved game.');
    for (const uci of state.moves) {
      if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))
        throw new Error('Invalid saved move.');
      const src = position(uci.slice(0, 2)),
        dst = position(uci.slice(2, 4));
      const piece = restored.get(src);
      const candidate = restored.moves(piece).find((m) => m.dst === dst);
      if (!candidate || !restored.move({ ...candidate, promotion: uci[4] }))
        throw new Error('Illegal saved move.');
    }
    if (restored.engine.fen() !== state.fen)
      throw new Error('Saved position does not match its moves.');
    this.engine = restored.engine;
    this.history = restored.history;
    this.initialFen = restored.initialFen;
    this.sync();
  }
}
