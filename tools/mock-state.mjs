// Будує стан кімнати у форматі richup (як store.getState().state) з data/board-classic.json — для тестів.
import { readFileSync } from 'node:fs';

const board = JSON.parse(readFileSync(new URL('../data/board-classic.json', import.meta.url), 'utf8'));
const COUNTRY = { uk: 'united-kingdom', usa: 'united-states-of-america' };

export function makeBlocks() {
  return board.squares.map((q) => {
    switch (q.type) {
      case 'start': return { name: 'Start', type: 'corner', cornerType: 'go' };
      case 'street': return { name: q.name, type: 'city', countryId: COUNTRY[q.group] || q.group, price: q.price, housePrice: q.housePrice, hotelPrice: q.hotelPrice,
        rentPrices: Object.fromEntries(q.rent.map((r, i) => [String(i), r])), level: 0, ownerId: null, isMortgaged: false };
      case 'airport': return { name: q.name, type: 'airport', price: 200, rentPrices: [25, 50, 100, 200], ownerId: null, isMortgaged: false };
      case 'utility': return { name: q.name, type: 'company', companyType: q.i === 12 ? 'electricity' : 'water', price: 150, ownerId: null, isMortgaged: false };
      case 'treasure': return { name: 'Treasure', type: 'bonus', bonusType: 'treasure' };
      case 'surprise': return { name: 'Surprise', type: 'bonus', bonusType: 'surprise' };
      case 'tax': return q.percent ? { name: q.name, type: 'bonus', bonusType: 'tax', taxPercentage: q.percent } : { name: q.name, type: 'bonus', bonusType: 'premium-tax', taxAmount: q.amount };
      case 'prison': return { name: 'Prison', type: 'corner', cornerType: 'prison', suspendedTurnsRemaining: {}, suspensionAmount: 3 };
      case 'vacation': return { name: 'Vacation', type: 'corner', cornerType: 'vacation', suspendedTurnsRemaining: {}, suspensionAmount: 1 };
      case 'gotoprison': return { name: 'Go to prison', type: 'corner', cornerType: 'go-to-prison' };
    }
  });
}

function cardsFrom(list, deck) {
  return list.map((c, i) => {
    let effect;
    if (c.earn) effect = { type: 'money-event', moneyType: 'earn', amount: c.earn };
    else if (c.pay) effect = { type: 'money-event', moneyType: 'pay', amount: c.pay };
    else if (c.collectFromEach) effect = { type: 'collect-from-each-player', amount: c.collectFromEach };
    else if (c.payEach) effect = { type: 'pay-each-player', amount: c.payEach };
    else if (c.repairs) effect = { type: 'repairs', perHouse: c.repairs[0], perHotel: c.repairs[1] };
    else if (c.goToPrison) effect = { type: 'go-to-prison' };
    else if (c.pardon) effect = { type: 'get-pardon-card', deck };
    else if (c.moveTo !== undefined) effect = { type: 'move-to-block', blockIndex: c.moveTo, collectGo: true };
    else if (c.moveToNext) effect = { type: 'move-to-next-grouped', group: c.moveToNext };
    else if (c.moveSteps) effect = { type: 'move-steps', steps: c.moveSteps };
    return { id: deck + '-' + i, description: '', effect };
  });
}

export function makeState({ players = 4, names = ['Kolia', 'Andrii', 'Oleh', 'Ira', 'Max', 'Dana'], money = 1500 } = {}) {
  const participants = Array.from({ length: players }, (_, i) => ({
    id: 'p' + i, name: names[i], appearance: ['#7FE7F5', '#E85D5D', '#73E85D', '#F5C842', '#B05DE8', '#5D8BE8'][i],
    isBot: false, teamId: null, position: 0, money, bankruptedAt: null, debtTo: null
  }));
  return {
    id: 'mock', phase: 'playing', participants, currentPlayerIndex: 0, mapId: 'classic', blocks: makeBlocks(),
    boardConfig: { goReward: { land: 300, pass: 200 }, prisonBlockIndex: 10, goToPrisonBlockIndex: 30, vacationBlockIndex: 20 },
    dice: [3, 4], cubesRolledInTurn: false, canPerformTurnActions: true, doublesInARow: 0, auction: null, trades: [],
    bonusCards: { treasure: { cards: cardsFrom(board.cards.treasure, 'treasure'), currentIndex: 0, pardonCardHolderId: null },
                  surprise: { cards: cardsFrom(board.cards.surprise, 'surprise'), currentIndex: 0, pardonCardHolderId: null } },
    vacationCash: 0,
    settings: { maxPlayers: 6, canBotsJoin: false, isPrivate: true, onlyUsers: false, payDoubleRentWhenOwnFullSet: true, vacationCash: true,
      auction: true, noRentPaymentsWhileInPrison: false, mortgage: true, startingCash: 1500, evenBuild: true, shufflePlayerOrder: true },
    stampedFlags: { tradeFairnessRules: true }, hostId: 'p0', winnerId: null
  };
}

export const own = (s, pid, names) => { for (const n of names) { const b = s.blocks.find((x) => x.name === n); b.ownerId = pid; } return s; };
export const idxOf = (s, n) => s.blocks.findIndex((x) => x.name === n);
