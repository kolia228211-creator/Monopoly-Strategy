// Правила richup.io, відтворені з клієнтського коду гри (див. docs/PROTOCOL.md).
// Усі функції працюють зі "станом кімнати" (store.getState().state) або його копією.

export const BUYABLE = { city: 1, airport: 1, company: 1 };
export const PRISON_FEE = 50;          // const Ni=50 у коді гри
export const PARDON_VALUE = 50;        // const In=50 (вартість картки Pardon в обмінах)
export const FAIRNESS_RATIO = 0.9;     // const sh=.9 (діє лише в публічних кімнатах)
export const HOTEL = 5;

export const GROUP_UA = {
  brazil: 'Бразилія', israel: 'Ізраїль', italy: 'Італія', germany: 'Німеччина', china: 'Китай',
  france: 'Франція', 'united-kingdom': 'Британія', 'united-states-of-america': 'США'
};
export const groupName = (g) => GROUP_UA[g] || (g ? g.replace(/-/g, ' ') : '');

export function rentAt(b, level) {
  const rp = b.rentPrices;
  if (!rp) return 0;
  return Array.isArray(rp) ? (rp[level] ?? 0) : (rp[String(level)] ?? rp[level] ?? 0);
}

export const isBuyable = (b) => !!(b && BUYABLE[b.type]);
export const groupKey = (b) => b.type === 'city' ? b.countryId : b.type === 'airport' ? '@airport' : b.type === 'company' ? '@company' : null;

export function prisonIndex(s) {
  return s.boardConfig?.prisonBlockIndex ?? s.blocks.findIndex((b) => b.cornerType === 'prison');
}
export function vacationIndex(s) {
  return s.boardConfig?.vacationBlockIndex ?? s.blocks.findIndex((b) => b.cornerType === 'vacation');
}
export function inPrison(s, pid) {
  const b = s.blocks[prisonIndex(s)];
  return !!(b && b.suspendedTurnsRemaining && b.suspendedTurnsRemaining[pid] > 0);
}

export function groupIndices(s, key) {
  const out = [];
  s.blocks.forEach((b, i) => { if (isBuyable(b) && groupKey(b) === key) out.push(i); });
  return out;
}

// Власник усього набору (міста однієї країни) або null
export function setOwner(s, key) {
  const idx = groupIndices(s, key);
  if (!idx.length) return null;
  const o = s.blocks[idx[0]].ownerId;
  return o && idx.every((i) => s.blocks[i].ownerId === o) ? o : null;
}

export function countOwned(s, type, pid) {
  let n = 0;
  for (const b of s.blocks) if (b.type === type && b.ownerId === pid) n++;
  return n;
}

// Скільки заплатить гравець, ставши на клітинку idx (diceSum потрібен для компаній)
export function rentFor(s, idx, diceSum = 7) {
  const b = s.blocks[idx];
  if (!b || !b.ownerId || b.isMortgaged) return 0;
  if (s.settings?.noRentPaymentsWhileInPrison && inPrison(s, b.ownerId)) return 0;
  if (b.type === 'city') {
    let r = rentAt(b, b.level || 0);
    if (!b.level && s.settings?.payDoubleRentWhenOwnFullSet && setOwner(s, b.countryId) === b.ownerId) r *= 2;
    return r;
  }
  if (b.type === 'airport') {
    const n = countOwned(s, 'airport', b.ownerId);
    const rp = b.rentPrices || [25, 50, 100, 200];
    return (Array.isArray(rp) ? rp : Object.values(rp))[Math.max(0, n - 1)] || 0;
  }
  if (b.type === 'company') return (countOwned(s, 'company', b.ownerId) >= 2 ? 10 : 4) * diceSum;
  return 0;
}

// Вартість активів як у грі (Or): ціна незакладених + будинки
export function assetValue(s, pid) {
  let v = 0;
  for (const b of s.blocks) {
    if (b.ownerId !== pid || b.isMortgaged) continue;
    v += b.price || 0;
    if (b.type === 'city') v += (b.level || 0) * (b.housePrice || 0);
  }
  return v;
}
// Скільки можна виручити, продавши будинки й заклавши все (Nr)
export function liquidationValue(s, pid) {
  let v = 0;
  for (const b of s.blocks) {
    if (b.ownerId !== pid || b.isMortgaged) continue;
    v += (b.price || 0) / 2;
    if (b.type === 'city') v += (b.level || 0) * (b.housePrice || 0) / 2;
  }
  return v;
}

export const alivePlayers = (s) => s.participants.filter((p) => !p.bankruptedAt);
export const currentPlayer = (s) => s.participants[s.currentPlayerIndex] || null;

// Чи можна поставити будинок на місто (рівномірна забудова)
export function canUpgrade(s, idx, pid) {
  const b = s.blocks[idx];
  if (!b || b.type !== 'city' || b.ownerId !== pid || b.isMortgaged || (b.level || 0) >= HOTEL) return false;
  const g = groupIndices(s, b.countryId);
  if (!g.every((i) => s.blocks[i].ownerId === pid && !s.blocks[i].isMortgaged)) return false;
  if (s.settings?.evenBuild !== false) {
    const min = Math.min(...g.map((i) => s.blocks[i].level || 0));
    if ((b.level || 0) > min) return false;
  }
  return true;
}
export function canDowngrade(s, idx, pid) {
  const b = s.blocks[idx];
  if (!b || b.type !== 'city' || b.ownerId !== pid || !(b.level > 0)) return false;
  if (s.settings?.evenBuild !== false) {
    const g = groupIndices(s, b.countryId);
    const max = Math.max(...g.map((i) => s.blocks[i].level || 0));
    if (b.level < max) return false;
  }
  return true;
}
export function canMortgage(s, idx, pid) {
  const b = s.blocks[idx];
  if (!b || !isBuyable(b) || b.ownerId !== pid || b.isMortgaged) return false;
  if (s.settings && s.settings.mortgage === false) return false;
  if (b.type === 'city' && groupIndices(s, b.countryId).some((i) => s.blocks[i].level > 0)) return false;
  return true;
}

// Перевірка "чесності" обміну (Gi) для публічних кімнат
export function tradeFairnessOk(s, giverId, give, get) {
  if (!s.stampedFlags?.tradeFairnessRules || s.settings?.isPrivate) return true;
  const val = (o) => (o.money || 0) + [...new Set(o.propertyIndices || [])].reduce((a, i) => a + (s.blocks[i]?.isMortgaged ? 0 : (s.blocks[i]?.price || 0)), 0)
    + new Set(o.pardonCards || []).size * PARDON_VALUE;
  // У коді гри: c > sh * (Or(гравець) + борг) => відмова. Борг поза боргом рахуємо як 0.
  const c = val(give) - val(get);
  return c <= 0 || c <= FAIRNESS_RATIO * assetValue(s, giverId);
}
