"""Швидкий Монте-Карло симулятор партії (правила з Rules). Один клас Game, стратегії — словники параметрів."""
import random
from .markov import stationary

class Precomp:
    """Те, що рахується один раз на набір правил: ймовірності потраплянь, дохід груп."""
    def __init__(self, r):
        self.r = r
        self.land = stationary(r, "leave")["land"]
        self.inc = {}   # (група, рівень) -> очікувана оренда за хід одного суперника
        for g in r.street_groups:
            for lv in range(6):
                self.inc[(g,lv)] = sum(self.land[i]*r.street_rent(i,lv,True) for i in r.groups[g])
        self.gprice = {g: sum(r.price[i] for i in r.groups[g]) for g in r.street_groups}
        self.hcost = {g: r.house_price[r.groups[g][0]]*len(r.groups[g]) for g in r.street_groups}
        # Wper(g): валовий дохід від ОДНОГО суперника за горизонт H=25 його ходів при 3 будинках
        self.H = 25
        self.Wper = {g: self.inc[(g,3)]*self.H for g in r.street_groups}
        # пріоритет будівництва: приріст доходу на $ при переході 2->3 будинки
        self.build_prio = sorted(r.street_groups, key=lambda g: -(self.inc[(g,3)]-self.inc[(g,0)])/(3*self.hcost[g]))

BASE = dict(name="base", reserve=50, bid_mult=1.0, early_mult=1.15, late_mult=0.8, target=3, build_reserve=150,
            extra_build_cash=600, trade=True, kappa=0.6, jail="smart", allowed=None, focus=None,
            focus_mult=1.0, buy_min_after=0, complete_k=0.5, block_k=0.35)

def strat(**kw):
    s = dict(BASE); s.update(kw); return s

class Game:
    def __init__(self, r, pre, strategies, rng, max_rounds=None, vacation=None):
        self.r, self.pre, self.S, self.rng = r, pre, strategies, rng
        n = self.n = len(strategies)
        self.cash = [r.cfg["startingCash"]]*n
        self.pos = [0]*n; self.alive = [True]*n; self.jail = [-1]*n; self.goojf = [0]*n
        self.owner = [-1]*40; self.houses = [0]*40; self.mort = [False]*40
        self.pot = 0; self.hleft = r.cfg["houseLimit"]; self.Hleft = r.cfg["hotelLimit"]
        self.vac = r.cfg["vacationCash"] if vacation is None else vacation
        self.max_rounds = max_rounds or r.cfg["maxRounds"]
        self.stats = dict(vac_paid=[0]*n, rent_in=[0]*n, house_shortage=0, trades=0, auctions=0)
        self.gsize = {g: len(v) for g,v in r.groups.items()}
        self.tdeck = {"surprise": list(range(len(r.cards["surprise"]))), "treasure": list(range(len(r.cards["treasure"])))}
        for d in self.tdeck.values(): rng.shuffle(d)
    # ---------- допоміжне ----------
    def nalive(self): return sum(self.alive)
    def T(self, g):
        """Чиста цінність повного набору для власника: (N-1)*Wper - вартість 3 будинків."""
        return max(0.0, (self.nalive()-1)*self.pre.Wper[g] - 3*self.pre.hcost[g])
    def owns_set(self, p, g):
        return all(self.owner[i]==p for i in self.r.groups[g])
    def unowned_share(self):
        o = self.r.ownable; return sum(1 for i in o if self.owner[i]<0)/len(o)
    def net_worth(self, p):
        r=self.r; w=self.cash[p]
        for i in r.ownable:
            if self.owner[i]==p:
                w += r.price[i]*(r.cfg["mortgageRate"] if self.mort[i] else 1.0) + self.houses[i]*r.house_price[i]*r.cfg["houseSellRate"]
        return w
    def pay_bank(self, p, amt):
        """Платіж банку: при vacation cash іде в банк відпустки."""
        paid = self.charge(p, amt, None)
        if self.vac: self.pot += paid
    def charge(self, p, amt, creditor):
        """Списати amt з p (з продажем/закладом). Повертає реально сплачену суму."""
        if amt <= 0: return 0
        if self.cash[p] < amt: self.raise_cash(p, amt)
        if self.cash[p] >= amt:
            self.cash[p] -= amt
            if creditor is not None: self.cash[creditor] += amt; self.stats["rent_in"][creditor] += amt
            return amt
        paid = max(0, self.cash[p]); self.bankrupt(p, creditor); return paid
    # ---------- гроші при нестачі ----------
    def raise_cash(self, p, need):
        r = self.r; pre = self.pre
        mine = [i for i in r.ownable if self.owner[i]==p]
        # 1) заклад ділянок не з повних наборів (найменший дохід першим)
        def lone_val(i):
            return pre.land[i]*(r.rent[i][0] if r.types[i]=="street" else 50)
        for i in sorted([i for i in mine if not self.mort[i] and self.houses[i]==0 and
                         not (r.types[i]=="street" and self.owns_set(p, r.group[i]))], key=lone_val):
            if self.cash[p] >= need: return
            self.mort[i] = True; self.cash[p] += int(r.price[i]*r.cfg["mortgageRate"])
        # 2) продаж будинків (рівномірно, спершу з групи з найменшою втратою доходу на $)
        while self.cash[p] < need:
            built = [g for g in r.street_groups if self.owns_set(p,g) and any(self.houses[i]>0 for i in r.groups[g])]
            if not built: break
            def loss(g):
                lv = max(self.houses[i] for i in r.groups[g])
                return (pre.inc[(g,lv)]-pre.inc[(g,lv-1)])/pre.hcost[g]
            g = min(built, key=loss)
            i = max(r.groups[g], key=lambda k: self.houses[k])
            if self.houses[i]==5:
                if self.hleft >= 4: self.hleft -= 4; self.Hleft += 1; self.houses[i]=4
                else:  # немає будинків для розміну готелю — продаємо все в групі
                    for k in r.groups[g]:
                        self.cash[p] += int(self.houses[k]*r.house_price[k]*r.cfg["houseSellRate"])
                        if self.houses[k]==5: self.Hleft+=1
                        else: self.hleft+=self.houses[k]
                        self.houses[k]=0
                    continue
            else: self.houses[i]-=1; self.hleft+=1
            self.cash[p] += int(r.house_price[i]*r.cfg["houseSellRate"])
        # 3) заклад решти
        for i in sorted([i for i in mine if not self.mort[i] and self.houses[i]==0], key=lone_val):
            if self.cash[p] >= need: return
            if r.types[i]=="street" and any(self.houses[k]>0 for k in r.groups[r.group[i]]): continue
            self.mort[i] = True; self.cash[p] += int(r.price[i]*r.cfg["mortgageRate"])
    def bankrupt(self, p, creditor):
        r = self.r; self.alive[p] = False
        for i in r.ownable:
            if self.owner[i]==p:
                if self.houses[i]==5: self.Hleft+=1
                else: self.hleft+=self.houses[i]
                self.houses[i]=0
                if creditor is None: self.owner[i]=-1; self.mort[i]=False
                else: self.owner[i]=creditor
        if creditor is not None: self.cash[creditor] += max(0,self.cash[p]); self.goojf[creditor]+=self.goojf[p]
        self.cash[p]=0
    # ---------- оцінка ділянки ----------
    def valuation(self, p, i):
        r, s, pre = self.r, self.S[p], self.pre
        g = r.group[i]; price = r.price[i]
        if s["allowed"] is not None and g not in s["allowed"]: return 0
        u = self.unowned_share()
        base = price*(s["early_mult"] if u>0.5 else (1.0 if u>0.2 else s["late_mult"]))
        if r.types[i] != "street":
            k = sum(1 for j in r.groups[g] if self.owner[j]==p)
            v = base*(1+0.15*k)
        else:
            others = [j for j in r.groups[g] if j!=i]
            mine = sum(1 for j in others if self.owner[j]==p)
            opp = set(self.owner[j] for j in others if self.owner[j]>=0 and self.owner[j]!=p)
            v = base
            if mine == len(others): v += s["complete_k"]*self.T(g)           # завершує мій набір
            elif mine>0 and not opp: v *= 1.0+0.2*mine
            if len(opp)==1 and all(self.owner[j]>=0 and self.owner[j]!=p for j in others):
                v += s["block_k"]*pre.Wper[g]               # блокує набір суперника
            if s["focus"] and g in s["focus"]: v *= s["focus_mult"]
        return v*s["bid_mult"]
    # ---------- купівля та аукціон ----------
    def offer(self, p, i):
        r, s = self.r, self.S[p]; price = r.price[i]
        v = self.valuation(p, i)
        if v >= price and self.cash[p]-price >= max(s["reserve"], s["buy_min_after"]):
            self.cash[p]-=price; self.owner[i]=p; return
        if r.cfg["auction"]: self.auction(i)
    def auction(self, i):
        self.stats["auctions"] += 1
        bids = []
        for q in range(self.n):
            if not self.alive[q]: continue
            m = min(self.valuation(q,i), self.cash[q]-self.S[q]["reserve"]*0.5)
            if m >= 1: bids.append((int(m), self.rng.random(), q))
        if not bids: return
        bids.sort(reverse=True)
        w = bids[0][2]; price = (bids[1][0]+1) if len(bids)>1 else 1
        price = min(price, bids[0][0])
        self.cash[w] -= price; self.owner[i] = w
    # ---------- оренда ----------
    def rent_due(self, i, dice, special=None):
        r = self.r; o = self.owner[i]
        if self.mort[i]: return 0
        t = r.types[i]
        if t=="street":
            g=r.group[i]; return r.street_rent(i, self.houses[i], self.owns_set(o,g))
        if t=="airport":
            k = sum(1 for j in r.airports if self.owner[j]==o)
            return r.airport_rent[k-1]*(2 if special=="airport" else 1)
        k = sum(1 for j in r.utilities if self.owner[j]==o)
        if special=="utility": return 10*(self.rng.randint(1,6)+self.rng.randint(1,6))
        return r.util_mult[k-1]*dice
    # ---------- рух ----------
    def move_to(self, p, dest, passing=True):
        if passing and dest < self.pos[p] and dest != 0: self.cash[p] += self.r.cfg["passStartBonus"]
        self.pos[p] = dest
    def land(self, p, dice, special=None, depth=0):
        r = self.r; i = self.pos[p]; t = r.types[i]
        if t=="start": self.cash[p] += r.cfg["landStartBonus"]
        elif t in ("street","airport","utility"):
            o = self.owner[i]
            if o<0: self.offer(p,i)
            elif o!=p and self.alive[o]: self.charge(p, self.rent_due(i,dice,special), o)
        elif t=="tax":
            sq = r.sq[i]
            amt = int(self.cash[p]*r.cfg["earningsTaxPercent"]/100) if "percent" in sq else r.cfg["premiumTax"]
            self.pay_bank(p, amt)
        elif t=="vacation":
            if self.vac and self.pot>0:
                self.cash[p]+=self.pot; self.stats["vac_paid"][p]+=self.pot; self.pot=0
        elif t=="gotoprison": self.to_jail(p)
        elif t in ("surprise","treasure") and depth<3: self.card(p, t, dice, depth)
    def to_jail(self, p):
        self.pos[p]=self.r.jail; self.jail[p]=0
    def card(self, p, deck, dice, depth):
        d = self.tdeck[deck]; k = d.pop(0); d.append(k)
        c = self.r.cards[deck][k]; t = c["t"]; r=self.r
        if t=="move": self.move_to(p, c["to"]); self.land(p,dice,None,depth+1)
        elif t=="nearest":
            lst = r.airports if c["kind"]=="airport" else r.utilities
            pos=self.pos[p]; dest = next((pos+s)%40 for s in range(1,41) if (pos+s)%40 in lst)
            self.move_to(p,dest); self.land(p,dice,c["kind"],depth+1)
        elif t=="back": self.pos[p]=(self.pos[p]-c["steps"])%40; self.land(p,dice,None,depth+1)
        elif t=="jail": self.to_jail(p)
        elif t=="jailfree": self.goojf[p]+=1
        elif t=="money":
            if c["amount"]>=0: self.cash[p]+=c["amount"]
            else: self.pay_bank(p,-c["amount"])
        elif t=="repairs":
            amt = sum((c["hotel"] if self.houses[i]==5 else c["house"]*self.houses[i]) for i in r.ownable if self.owner[i]==p)
            self.pay_bank(p, amt)
        elif t=="payeach":
            for q in range(self.n):
                if q!=p and self.alive[q] and self.alive[p]: self.charge(p,c["amount"],q)
        elif t=="collecteach":
            for q in range(self.n):
                if q!=p and self.alive[q] and self.alive[p]: self.charge(q,c["amount"],p)
    # ---------- будівництво ----------
    def build(self, p):
        r, s, pre = self.r, self.S[p], self.pre
        sets = [g for g in pre.build_prio if self.owns_set(p,g)]
        if not sets: return
        for g in sets:   # викуп із застави
            for i in r.groups[g]:
                if self.mort[i]:
                    c = int(r.price[i]*r.cfg["unmortgageRate"])
                    if self.cash[p]-c >= s["build_reserve"]: self.cash[p]-=c; self.mort[i]=False
        for phase_target in ([s["target"], 5] if s["target"]<5 else [5]):
            for g in sets:
                grp = r.groups[g]
                if any(self.mort[i] for i in grp): continue
                while True:
                    lv = min(self.houses[i] for i in grp)
                    if lv >= phase_target: break
                    reserve = s["build_reserve"] if phase_target==s["target"] else max(s["build_reserve"], s["extra_build_cash"])
                    i = min(grp, key=lambda k: self.houses[k])
                    hp = r.house_price[i]
                    if self.cash[p]-hp < reserve: return
                    if self.houses[i]==4:
                        if self.Hleft<=0: break
                        self.Hleft-=1; self.hleft+=4
                    else:
                        if self.hleft<=0: self.stats["house_shortage"]+=1; break
                        self.hleft-=1
                    self.houses[i]+=1; self.cash[p]-=hp
    # ---------- торгівля ----------
    def try_trade(self, p):
        r, s, pre = self.r, self.S[p], self.pre
        if not s["trade"]: return
        na = self.nalive()
        for g in sorted(r.street_groups, key=lambda g: -self.T(g)):
            if s["allowed"] is not None and g not in s["allowed"]: continue
            grp = r.groups[g]
            mine = [i for i in grp if self.owner[i]==p]
            other = [i for i in grp if self.owner[i]!=p]
            if not mine or not other: continue
            owners = set(self.owner[i] for i in other)
            if len(owners)!=1: continue
            o = owners.pop()
            if o<0 or not self.alive[o] or not self.S[o]["trade"]: continue
            if any(self.houses[i]>0 for i in grp): continue
            # 1) взаємне завершення наборів (обмін 1<->1 з доплатою)
            for h in r.street_groups:
                if h==g: continue
                hg = r.groups[h]
                hm = [i for i in hg if self.owner[i]==p]
                if hm and all(self.owner[i] in (p,o) for i in hg) and any(self.owner[i]==o for i in hg) \
                   and not any(self.houses[i]>0 for i in hg):
                    diff = (self.T(g)-self.T(h))*0.5   # хто отримує кращий набір, той доплачує половину різниці
                    if diff>0 and self.cash[p]-diff < s["reserve"]: continue
                    if diff<0 and self.cash[o]+diff < self.S[o]["reserve"]: continue
                    for i in other: self.owner[i]=p
                    for i in hm: self.owner[i]=o
                    self.cash[p]-=int(diff); self.cash[o]+=int(diff); self.stats["trades"]+=1
                    return
            # 2) купівля за гроші
            missing_price = sum(r.price[i] for i in other)
            max_pay = min(self.cash[p]-s["reserve"]-pre.hcost[g], missing_price + s["kappa"]*self.T(g)*(s["focus_mult"] if s["focus"] and g in s["focus"] else 1))
            o_has = len(other)
            ask = missing_price*1.5 + pre.Wper[g]*(1+0.5*(o_has-1))
            if max_pay >= ask:
                pay = int((max_pay+ask)/2)
                for i in other: self.owner[i]=p
                self.cash[p]-=pay; self.cash[o]+=pay; self.stats["trades"]+=1
                return
    # ---------- хід ----------
    def jail_leave_now(self, p):
        pol = self.S[p]["jail"]
        if pol=="leave": return True
        if pol=="stay": return False
        if self.unowned_share() > 0.25: return True
        for q in range(self.n):
            if q!=p and self.alive[q]:
                for g in self.r.street_groups:
                    if self.owns_set(q,g) and min(self.houses[i] for i in self.r.groups[g])>=2: return False
        return True
    def roll(self): return self.rng.randint(1,6), self.rng.randint(1,6)
    def turn(self, p):
        r = self.r
        self.try_trade(p)
        if not self.alive[p]: return
        if self.jail[p] >= 0:
            if self.jail_leave_now(p):
                if self.goojf[p]>0: self.goojf[p]-=1
                else: self.pay_bank(p, r.fine)
                self.jail[p]=-1
                if not self.alive[p]: return
            else:
                a,b = self.roll()
                if a!=b and self.jail[p] < r.cfg["prison"]["maxTurns"]-1:
                    self.jail[p]+=1; return
                if a!=b: self.pay_bank(p, r.fine)
                if not self.alive[p]: return
                self.jail[p]=-1; self.move_to(p,(self.pos[p]+a+b)%40); self.land(p,a+b)
                if self.alive[p]: self.build(p)
                return
        d = 0
        while self.alive[p]:
            a,b = self.roll()
            if a==b and d==2: self.to_jail(p); break
            np_ = (self.pos[p]+a+b)%40
            if np_ < self.pos[p] and np_!=0: self.cash[p]+=r.cfg["passStartBonus"]
            self.pos[p]=np_; self.land(p,a+b)
            if self.jail[p]>=0 or a!=b: break
            d+=1
        if self.alive[p]: self.build(p)
    def play(self):
        rounds = 0
        while rounds < self.max_rounds:
            rounds += 1
            for p in range(self.n):
                if self.alive[p]: self.turn(p)
                if self.nalive()<=1: break
            if self.nalive()<=1: break
        alive = [p for p in range(self.n) if self.alive[p]]
        timeout = len(alive)>1
        winner = max(alive, key=self.net_worth)
        return dict(winner=winner, rounds=rounds, timeout=timeout, vac=list(self.stats["vac_paid"]),
                    trades=self.stats["trades"], shortage=self.stats["house_shortage"])
