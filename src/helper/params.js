// Параметри стратегії помічника. Значення за замовчуванням = ручні формули v0.4;
// знайдені self-play значення (tools/selfplay) підставляються окремо для x2 ON / x2 OFF.
export const BASE = {
  stageEarly: 1.15, stageLate: 0.8, H: 25, complete: 0.5, step: 0.15, block: 0.35, air: 0.4,
  buyMin: 0.85, resBase: 60, resLate: 160, aucMult: 1.0, aucKeep: 40,
  bRes: 120, bResGrow: 4, maxLevel: 5, unmortCash: 500, jailU: 0.25,
  trade: 1, buyShare: 0.6, swapPay: 1.0, deny: 0.6, acceptMargin: 40, buildCashLots: 1
};
// Self-play 2026-11-01: 1 192 000 партій (tools/selfplay). Перемоги (норм. на стіл з 4):
// x2 ON: проти суміші 22.1% -> 40.5%, проти людиноподібних 24.3% -> 34.5%
// x2 OFF: проти суміші 22.0% -> 41.7%, проти людиноподібних 24.0% -> 36.4%
export const TUNED = {
 "dbl1": {
  "stageEarly": 0.996,
  "stageLate": 1.186,
  "H": 18,
  "complete": 0.514,
  "step": 0.301,
  "block": 0.269,
  "air": 0.382,
  "buyMin": 0.33,
  "resBase": 82,
  "resLate": 104,
  "aucMult": 1.568,
  "aucKeep": 21,
  "bRes": 12,
  "bResGrow": 0.134,
  "maxLevel": 5,
  "unmortCash": 597,
  "jailU": 0.088,
  "trade": 0.892,
  "buyShare": 1.15,
  "swapPay": 1.218,
  "deny": 1.14,
  "acceptMargin": -20,
  "buildCashLots": 1.134
 },
 "dbl0": {
  "stageEarly": 1.2,
  "stageLate": 1.191,
  "H": 16,
  "complete": 0.911,
  "step": 0.025,
  "block": 0.431,
  "air": 0.158,
  "buyMin": 0.12,
  "resBase": 20,
  "resLate": 2.881,
  "aucMult": 1.504,
  "aucKeep": 84,
  "bRes": 15,
  "bResGrow": 0.004,
  "maxLevel": 5,
  "unmortCash": 782,
  "jailU": 0.153,
  "trade": 0.811,
  "buyShare": 1.021,
  "swapPay": 1.477,
  "deny": 1.192,
  "acceptMargin": 112,
  "buildCashLots": 2.119
 },
 "meta": {
  "date": "2026-11-01",
  "games": 1192000,
  "dbl1": {
   "vsMixed": [
    0.22145833333333334,
    0.40525
   ],
   "vsHumans": [
    0.242625,
    0.3453125
   ]
  },
  "dbl0": {
   "vsMixed": [
    0.22,
    0.41729166666666667
   ],
   "vsHumans": [
    0.23975,
    0.363875
   ]
  },
  "firstSet": {
   "dbl1": {
    "united-states-of-america": 0.66,
    "germany": 0.598,
    "italy": 0.551,
    "israel": 0.518,
    "china": 0.436,
    "france": 0.432,
    "brazil": 0.429,
    "united-kingdom": 0.414,
    "none": 0.003
   },
   "dbl0": {
    "united-states-of-america": 0.669,
    "italy": 0.617,
    "germany": 0.595,
    "israel": 0.576,
    "china": 0.477,
    "france": 0.436,
    "brazil": 0.435,
    "united-kingdom": 0.424,
    "none": 0.005
   }
  }
 }
};
export function paramsFor(s) {
  const t = s && s.settings && s.settings.payDoubleRentWhenOwnFullSet ? TUNED.dbl1 : TUNED.dbl0;
  return t ? { ...BASE, ...t } : BASE;
}
