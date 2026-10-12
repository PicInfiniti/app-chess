export const INITIAL_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const EMPTY_STATE = { moves: [], fen: INITIAL_FEN, result: null };
export const MAX_MOVES = 1024;
export const revision = (state) => state.moves.length + (state.result ? 1 : 0);
export const canonical = (state) =>
  JSON.stringify({
    moves: state.moves,
    fen: state.fen,
    result: state.result
      ? { winner: state.result.winner, reason: state.result.reason }
      : null,
  });
export async function digest(value) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
export const checkpointHash = (state) => digest(canonical(state));
export function validState(state) {
  return Boolean(
    state &&
    Array.isArray(state.moves) &&
    state.moves.length <= MAX_MOVES &&
    state.moves.every(
      (m) => typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m),
    ) &&
    typeof state.fen === 'string' &&
    state.fen.length <= 120 &&
    state.fen.length > 0 &&
    (state.result === null ||
      (state.result &&
        ['w', 'b'].includes(state.result.winner) &&
        state.result.reason === 'resign')),
  );
}
// This checks protocol sequencing, not chess legality. Both browsers replay and
// validate the candidate before confirming it independently.
export function validTransition(previous, next, proposer) {
  if (!validState(next) || previous.result) return false;
  if (!previous.moves.every((m, i) => next.moves[i] === m)) return false;
  if (next.result)
    return (
      next.moves.length === previous.moves.length &&
      next.fen === previous.fen &&
      next.result.winner !== proposer
    );
  return (
    next.moves.length === previous.moves.length + 1 &&
    proposer === (previous.moves.length % 2 ? 'b' : 'w')
  );
}
