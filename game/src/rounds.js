// Rounds and money. A match is first to 4 round wins, at most 7 rounds.
// Each round opens with a 5-second freeze where the buy menu is live, then
// 100 seconds of play. A round ends by elimination, by the charge blowing,
// by a defuse, or by the clock running out with the charge unplanted.
// Kills pay $300, a round win $325, a loss $1400, a plant $300.
//
// The caller passes one api object and this module talks to the game only
// through it — every identifier below is either defined here or on that api
// object. (v1 broke this contract by naming an undefined `config`.)
export const FREEZE_SECONDS = 5;
export const ROUND_SECONDS = 100;
export const WIN_ROUNDS = 4;
export const MAX_ROUNDS = 7;
const START_MONEY = 800;
const KILL_REWARD = 300;
const WIN_REWARD = 325;
const LOSS_REWARD = 1400;
const PLANT_REWARD = 300;
const GRENADE_PRICE = 300;

export function createRounds(api) {
  // api: { random, bombPlanted(), onRoundStart(round, site), onLive(),
  //        onRoundEnd(winner, reason, score), onMatchEnd(score) }
  const state = {
    phase: 'lobby', // lobby | freeze | live | roundEnd | matchEnd
    round: 0,
    score: { attack: 0, defend: 0 },
    money: START_MONEY,
    attackSite: 'A',
    timer: 0,
    phaseLeft: 0,
    lastWinner: null,
    lastReason: '',
  };

  function startMatch() {
    state.phase = 'freeze';
    state.round = 1;
    state.score.attack = 0;
    state.score.defend = 0;
    state.money = START_MONEY;
    state.attackSite = api.random() < 0.5 ? 'A' : 'B';
    state.timer = ROUND_SECONDS;
    state.phaseLeft = FREEZE_SECONDS;
    api.onRoundStart(state.round, state.attackSite);
  }

  function startRound() {
    state.round += 1;
    state.attackSite = state.round % 2 === 1 ? 'A' : 'B';
    state.phase = 'freeze';
    state.timer = ROUND_SECONDS;
    state.phaseLeft = FREEZE_SECONDS;
    api.onRoundStart(state.round, state.attackSite);
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.lastWinner = winner;
    state.lastReason = reason;
    state.score[winner] += 1;
    state.money += winner === 'attack' ? WIN_REWARD : LOSS_REWARD;
    state.phase = 'roundEnd';
    state.phaseLeft = 3.5;
    api.onRoundEnd(winner, reason, { ...state.score });
  }

  function tick(dt) {
    if (state.phase === 'freeze') {
      state.phaseLeft -= dt;
      if (state.phaseLeft <= 0) {
        state.phase = 'live';
        api.onLive();
      }
      return;
    }
    if (state.phase === 'live') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.timer = 0;
        // A planted charge keeps the round alive: the fuse or a defuse ends
        // it, not the clock. bombPlanted comes from the api object the
        // caller passed in — never from a stray global.
        if (!api.bombPlanted || !api.bombPlanted()) {
          endRound('defend', 'Time expired — the charge was never planted');
        }
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      state.phaseLeft -= dt;
      if (state.phaseLeft <= 0) {
        if (state.score.attack >= WIN_ROUNDS || state.score.defend >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
          state.phase = 'matchEnd';
          api.onMatchEnd({ ...state.score });
        } else {
          startRound();
        }
      }
    }
  }

  return {
    state,
    startMatch,
    endRound,
    tick,
    onKill() {
      state.money += KILL_REWARD;
    },
    onPlant() {
      state.money += PLANT_REWARD;
    },
    canBuy() {
      return state.phase === 'freeze';
    },
    spend(amount) {
      if (state.money < amount) return false;
      state.money -= amount;
      return true;
    },
  };
}
