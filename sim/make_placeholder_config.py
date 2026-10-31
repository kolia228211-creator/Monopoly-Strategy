"""Генерує sim/config/rules.json із заглушками (класична US-Монополія, масштабована за ціною).
Запускати лише якщо треба відновити заглушки. Реальні цифри richup вписуйте прямо в rules.json
(або в data/board-classic.json з verified.rents=true) і запускайте run_all.py."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
# класичні US-оренди (0 буд., 1..4, готель) і ціни для тієї ж позиції в групі
CLASSIC = {
  "brazil":  [(60,[2,10,30,90,160,250]), (60,[4,20,60,180,320,450])],
  "israel":  [(100,[6,30,90,270,400,550]), (100,[6,30,90,270,400,550]), (120,[8,40,100,300,450,600])],
  "italy":   [(140,[10,50,150,450,625,750]), (140,[10,50,150,450,625,750]), (160,[12,60,180,500,700,900])],
  "germany": [(180,[14,70,200,550,750,950]), (180,[14,70,200,550,750,950]), (200,[16,80,220,600,800,1000])],
  "china":   [(220,[18,90,250,700,875,1050]), (220,[18,90,250,700,875,1050]), (240,[20,100,300,750,925,1100])],
  "france":  [(260,[22,110,330,800,975,1150]), (260,[22,110,330,800,975,1150]), (280,[24,120,360,850,1025,1200])],
  "uk":      [(300,[26,130,390,900,1100,1275]), (300,[26,130,390,900,1100,1275]), (320,[28,150,450,1000,1200,1400])],
  "usa":     [(350,[35,175,500,1100,1300,1500]), (400,[50,200,600,1400,1700,2000])],
}
HOUSE = {"brazil":50,"israel":50,"italy":100,"germany":100,"china":150,"france":150,"uk":200,"usa":200}
board = json.load(open(os.path.join(HERE,"..","data","board-classic.json")))
rents, seen = {}, {}
for sq in board["squares"]:
    if sq["type"]=="street":
        g=sq["group"]; k=seen.get(g,0); seen[g]=k+1
        cp, cr = CLASSIC[g][k]; f = sq["price"]/cp
        rents[str(sq["i"])] = [max(1,round(r*f)) for r in cr]
cfg = {
 "_comment": "Усі правила симулятора. status: exact = з налаштувань/скрінів користувача; placeholder = заглушка (класична Монополія). Змініть цифри й запустіть: python3 sim/run_all.py",
 "boardFile": "data/board-classic.json",
 "status": {
   "board_layout_prices": "exact", "settings": "exact",
   "streetRents": "placeholder", "housePrice": "placeholder", "airportRent": "placeholder",
   "utilityMultipliers": "placeholder", "cards": "placeholder", "startBonus": "placeholder",
   "prison": "placeholder", "earningsTax": "placeholder (10% від готівки)", "houseLimit": "placeholder",
   "mortgage": "exact (50%)", "unmortgage": "placeholder", "doubleRentOnFullSet": "unknown -> рахуємо обидва"
 },
 "startingCash": 1500,
 "passStartBonus": 200,
 "landStartBonus": 300,
 "doubleRentOnFullSet": True,
 "auction": True, "vacationCash": True, "rentInPrison": True, "evenBuild": True,
 "mortgageRate": 0.5, "unmortgageRate": 0.55, "houseSellRate": 0.5,
 "houseLimit": 32, "hotelLimit": 12,
 "earningsTaxPercent": 10, "premiumTax": 75,
 "prison": {"fine": 50, "maxTurns": 3, "threeDoublesToPrison": True},
 "housePrice": HOUSE,
 "streetRents": rents,
 "airportRent": [25,50,100,200],
 "utilityMultipliers": [4,10],
 "maxRounds": 400,
 "cards": {
  "surprise": [
    {"t":"move","to":0},{"t":"move","to":24},{"t":"move","to":11},{"t":"nearest","kind":"utility"},
    {"t":"nearest","kind":"airport"},{"t":"nearest","kind":"airport"},{"t":"money","amount":50},
    {"t":"jailfree"},{"t":"back","steps":3},{"t":"jail"},{"t":"repairs","house":25,"hotel":100},
    {"t":"money","amount":-15},{"t":"move","to":5},{"t":"move","to":39},{"t":"payeach","amount":50},
    {"t":"money","amount":150}],
  "treasure": [
    {"t":"move","to":0},{"t":"money","amount":200},{"t":"money","amount":-50},{"t":"money","amount":50},
    {"t":"jailfree"},{"t":"jail"},{"t":"money","amount":100},{"t":"money","amount":20},
    {"t":"collecteach","amount":10},{"t":"money","amount":100},{"t":"money","amount":-100},
    {"t":"money","amount":-50},{"t":"money","amount":25},{"t":"repairs","house":40,"hotel":115},
    {"t":"money","amount":10},{"t":"money","amount":100}]
 }
}
json.dump(cfg, open(os.path.join(HERE,"config","rules.json"),"w"), ensure_ascii=False, indent=1)
print("ok", rents)
