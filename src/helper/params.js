// Параметри стратегії помічника. Значення за замовчуванням = ручні формули v0.4;
// знайдені self-play значення (tools/selfplay) підставляються окремо для x2 ON / x2 OFF.
export const BASE = {
  stageEarly: 1.15, stageLate: 0.8, H: 25, complete: 0.5, step: 0.15, block: 0.35, air: 0.4,
  buyMin: 0.85, resBase: 60, resLate: 160, aucMult: 1.0, aucKeep: 40,
  bRes: 120, bResGrow: 4, maxLevel: 5, unmortCash: 500, jailU: 0.25,
  trade: 1, buyShare: 0.6, swapPay: 1.0, deny: 0.6, acceptMargin: 40, buildCashLots: 1,
  // v0.5.1 (tools/selfplay/arena): перша ціна в пропозиції купівлі (·ціна); правило "не віддавай ключову
  // ділянку дешевше ціна+deny·T" також в обміні 1↔1, де ти сам отримуєш набір (1/0); з якого рівня будинків
  // суперника сидіти в тюрмі; закладати ділянки поза наборами, щоб будувати (1/0)
  openMult: 1.5, floorInSwap: 1, jailDanger: 2, mortForBuild: 0
};
// Self-play 2026-11-01: 1 192 000 партій (tools/selfplay). Перемоги (норм. на стіл з 4):
// x2 ON: проти суміші 22.1% -> 40.5%, проти людиноподібних 24.3% -> 34.5%
// x2 OFF: проти суміші 22.0% -> 41.7%, проти людиноподібних 24.0% -> 36.4%
// Арена self-play 2026-11-01 (tools/selfplay/arena): стійкий sep-CMA-ES від v0.5.0, фітнес = середнє двох рушіїв
// (арена + evolve.mjs), 32 покоління × 16 × 1200 партій × 2 рушії ≈ 2.5 млн партій (+1.9 млн у пошуку лише в арені,
// відкинутому через перенавчання, + ~0.4 млн перевірочних на окремих seed). Перехресна перевірка в evolve.mjs
// (відносно, 1.0 = чесна частка): x2 OFF проти людиноподібних 1.44 → 1.40, проти v0.4+людей 1.75 → 1.75;
// x2 ON 1.34 → 1.49 і 1.62 → 1.76. Арена, % перемог:
// x2 OFF: проти людиноподібних (3/4/5/6 гравців) v0.4 38/37/35/31% → v0.5.0 44/43/41/37% → v0.5.1 56/51/46/42%
// x2 ON: проти людиноподібних (3/4/5/6 гравців) v0.4 39/37/35/31% → v0.5.0 47/47/45/40% → v0.5.1 49/45/44/41%
export const TUNED = {
 "dbl1": {
  "stageEarly": 1.119,
  "stageLate": 1.489,
  "H": 13.683,
  "complete": 1.464,
  "step": 0.514,
  "block": 0.223,
  "air": 0.73,
  "buyMin": 0.776,
  "resBase": 21.394,
  "resLate": 21.424,
  "aucMult": 2.11,
  "aucKeep": 44.912,
  "bRes": 4.169,
  "bResGrow": 0.267,
  "maxLevel": 5,
  "unmortCash": 721.041,
  "jailU": 0.058,
  "trade": 0.944,
  "buyShare": 1.492,
  "swapPay": 1.836,
  "deny": 1.525,
  "acceptMargin": 47.67,
  "buildCashLots": 0.879,
  "openMult": 1.697,
  "floorInSwap": 1,
  "jailDanger": 3,
  "mortForBuild": 0
 },
 "dbl0": {
  "stageEarly": 1.291,
  "stageLate": 1.566,
  "H": 17.919,
  "complete": 0.895,
  "step": 0.195,
  "block": 0.397,
  "air": 0.199,
  "buyMin": 0.507,
  "resBase": 8.685,
  "resLate": 1.26,
  "aucMult": 2.033,
  "aucKeep": 34.887,
  "bRes": 14.013,
  "bResGrow": 0.816,
  "maxLevel": 5,
  "unmortCash": 558.338,
  "jailU": 0.052,
  "trade": 0.963,
  "buyShare": 1.39,
  "swapPay": 1.187,
  "deny": 1.666,
  "acceptMargin": 2.958,
  "buildCashLots": 1.077,
  "openMult": 1.693,
  "floorInSwap": 1,
  "jailDanger": 2,
  "mortForBuild": 1
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
  },
  "arena": {
   "dbl0": {
    "date": "2026-11-01",
    "gens": 32,
    "gamesPerCand": 1200,
    "lambda": 16,
    "vsHumans": [
     {
      "n": 3,
      "v04": 0.384,
      "v050": 0.442,
      "v051": 0.5573
     },
     {
      "n": 4,
      "v04": 0.3667,
      "v050": 0.425,
      "v051": 0.5123
     },
     {
      "n": 5,
      "v04": 0.346,
      "v050": 0.4052,
      "v051": 0.4625
     },
     {
      "n": 6,
      "v04": 0.3128,
      "v050": 0.37,
      "v051": 0.4185
     }
    ]
   },
   "dbl1": {
    "date": "2026-11-01",
    "gens": 32,
    "gamesPerCand": 1200,
    "lambda": 16,
    "vsHumans": [
     {
      "n": 3,
      "v04": 0.386,
      "v050": 0.4725,
      "v051": 0.4927
     },
     {
      "n": 4,
      "v04": 0.3665,
      "v050": 0.4743,
      "v051": 0.4538
     },
     {
      "n": 5,
      "v04": 0.3455,
      "v050": 0.4482,
      "v051": 0.442
     },
     {
      "n": 6,
      "v04": 0.3128,
      "v050": 0.4017,
      "v051": 0.4125
     }
    ]
   }
  }
 }
};
export function paramsFor(s) {
  const t = s && s.settings && s.settings.payDoubleRentWhenOwnFullSet ? TUNED.dbl1 : TUNED.dbl0;
  return t ? { ...BASE, ...t } : BASE;
}
