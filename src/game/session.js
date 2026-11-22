// Sessions: who applies the rules, and how everyone hears about it.
//
// The view (play.js) only ever talks to a session:
//   session.state              current game state (read-only for the view)
//   session.start(setup)       new game (host only)
//   session.dispatch(action)   ask for an action; the result arrives through
//                              onUpdate(state, events) for everyone
//
// - createLocalSession: one device, everyone takes turns on it (today).
// - createHost + createClient: the multiplayer shape. Exactly one host owns
//   the state and applies every action with the rules (on a server, a cloud
//   function, or one player's device); clients send actions and receive
//   updates. A client can be on the host's device too. The host and clients
//   talk through a `transport`, so any hosted realtime service fits:
//     transport.send(message)          deliver a message to the other side
//     transport.onMessage(handler)     receive messages
//   Messages are plain JSON:
//     client -> host  { kind: 'join', clientId }
//                     { kind: 'claim', clientId, seat }
//                     { kind: 'action', clientId, action }
//     host -> client  { kind: 'update', seq, state, events, seats }
//                     { kind: 'reject', clientId, error }
//   Every update carries the whole state (it is small), so a phone that
//   drops off (a locked iPhone) catches up from the next update or by
//   sending 'join' again. `seq` lets a client ignore stale updates.
//   The host also needs the board: send the saved board JSON with the game
//   (GridState.parse), and wrap it with createBoard.
import { newGame, applyAction } from './rules.js';
import { publicState } from './mystery.js';
// Secrets (the mystery monster, face-down evidence, the dice generator) never
// leave the place that applies the rules: everyone else gets publicState().

// One device, hot-seat: every action is applied straight away.
export function createLocalSession({ board, onUpdate = () => {} }) {
  let full = null;     // the real state (secrets included): the rules use this
  let view = null;     // what the players may see: the screen uses this
  const publish = (events) => { view = publicState(full); onUpdate(view, events); };
  return {
    get state() { return view; },
    start(setup) {
      const r = newGame(board, setup);
      full = r.state;
      publish(r.events);
      return view;
    },
    dispatch(action) {
      if (!full) return { ok: false, error: 'no game' };
      const r = applyAction(full, board, action);
      if (r.ok) publish(r.events);
      return r;
    },
    // The whole state, secrets included, for a saved game (local play only:
    // a multiplayer host keeps this to itself).
    snapshot() { return full ? structuredClone(full) : null; },
    // Load a saved game (secrets included).
    load(saved) { full = structuredClone(saved); publish([{ type: 'loaded' }]); },
  };
}

// The authority: holds the state, applies actions, tells every client.
// `seats` maps seat -> clientId (who may act for which player).
export function createHost({ board, transport, onUpdate = () => {} }) {
  let state = null;
  let seq = 0;
  const seats = {};
  const broadcast = (events) => {
    seq++;
    transport.send({ kind: 'update', seq, state: publicState(state), events, seats });
    onUpdate(state, events);
  };
  transport.onMessage((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'join') {
      if (state) transport.send({ kind: 'update', seq, state: publicState(state), events: [{ type: 'start' }], seats });
    } else if (msg.kind === 'claim') {
      const taken = seats[msg.seat];
      if (taken && taken !== msg.clientId) transport.send({ kind: 'reject', clientId: msg.clientId, error: 'seat taken' });
      else { seats[msg.seat] = msg.clientId; broadcast([{ type: 'seats' }]); }
    } else if (msg.kind === 'action' && state) {
      const action = { ...msg.action };
      // A client may only act for a seat it holds (unclaimed seats are open).
      const owner = seats[state.cur];
      if (owner && owner !== msg.clientId) {
        transport.send({ kind: 'reject', clientId: msg.clientId, error: 'not your turn' });
        return;
      }
      action.seat = state.cur;
      const r = applyAction(state, board, action);
      if (r.ok) broadcast(r.events);
      else transport.send({ kind: 'reject', clientId: msg.clientId, error: r.error });
    }
  });
  return {
    get state() { return state; },
    seats,
    start(setup) {
      const r = newGame(board, setup);
      state = r.state;
      broadcast(r.events);
      return state;
    },
  };
}

// A player's device: sends actions, mirrors the host's state.
export function createClient({ clientId, transport, onUpdate = () => {}, onReject = () => {} }) {
  let state = null;
  let seq = -1;
  let seats = {};
  transport.onMessage((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'update' && msg.seq > seq) {
      seq = msg.seq;
      state = msg.state;
      seats = msg.seats ?? {};
      onUpdate(state, msg.events ?? []);
    } else if (msg.kind === 'reject' && msg.clientId === clientId) onReject(msg.error);
  });
  transport.send({ kind: 'join', clientId });
  return {
    get state() { return state; },
    get seats() { return seats; },
    claim(seat) { transport.send({ kind: 'claim', clientId, seat }); },
    dispatch(action) { transport.send({ kind: 'action', clientId, action }); return { ok: true, pending: true }; },
  };
}

// An in-memory transport pair for tests (and as a template for a real one):
// messages are deep-copied, as if they went over the wire.
export function loopback() {
  const handlers = { host: [], client: [] };
  const wire = (to) => (msg) => {
    const copy = JSON.parse(JSON.stringify(msg));
    for (const h of handlers[to]) h(copy);
  };
  return {
    host: { send: wire('client'), onMessage: (h) => handlers.host.push(h) },
    client: { send: wire('host'), onMessage: (h) => handlers.client.push(h) },
  };
}
