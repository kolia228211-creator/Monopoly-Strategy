"""Аналітика «на папері»: дохід груп, окупність, аукціон, обмін, тюрма."""
import numpy as np
from .markov import stationary, monte_carlo
from .rules import GROUP_UA

H = 25   # горизонт (ходів одного суперника) для оцінки цінності набору

def group_tables(r, land):
    out = {}
    for g in r.street_groups:
        sq = r.groups[g]; n = len(sq); hp = r.house_price[sq[0]]
        P = sum(r.price[i] for i in sq)
        inc = [float(sum(land[i]*r.street_rent(i,lv,True) for i in sq)) for lv in range(6)]
        inc_single0 = float(sum(land[i]*r.rent[i][0] for i in sq))
        cost = [P + lv*hp*n for lv in range(6)]
        payback = [cost[lv]/inc[lv] if inc[lv]>0 else float('inf') for lv in range(6)]
        marg = [None]+[(hp*n)/(inc[lv]-inc[lv-1]) if inc[lv]>inc[lv-1] else float('inf') for lv in range(1,6)]
        best = {}
        for T in (20, 40, 80):
            prof = [inc[lv]*T - (cost[lv]-P) for lv in range(6)]   # набір уже є; що дає забудова
            best[T] = int(np.argmax(prof))
        out[g] = dict(name=GROUP_UA[g], squares=sq, n=n, house=hp, price=P, inc=inc, cost=cost, payback=payback,
                      marginal=marg, best=best, land=float(sum(land[i] for i in sq)), inc_unset=inc_single0,
                      Wper=inc[3]*H, houses_needed4=4*n)
    # аеропорти й комунальні
    air = r.airports; la = float(sum(land[i] for i in air))
    out["airport"] = dict(name="Аеропорти", land=la, inc=[la/len(air)*k*r.airport_rent[k-1] for k in range(1,len(air)+1)],
                          cost=[200*k for k in range(1,len(air)+1)])
    ut = r.utilities; lu = float(sum(land[i] for i in ut))
    out["utility"] = dict(name="Комунальні", land=lu, inc=[lu/len(ut)*k*7*r.util_mult[k-1] for k in range(1,len(ut)+1)],
                          cost=[150*k for k in range(1,len(ut)+1)])
    return out

def T_value(gt, g, N):
    return max(0.0, (N-1)*gt[g]["Wper"] - 3*gt[g]["house"]*gt[g]["n"])

def auction_table(r, gt, N=4):
    """Макс. розумна ставка за кожну ділянку (до обмеження готівкою)."""
    rows=[]
    stage = {"рання":1.15, "середня":1.0, "пізня":0.8}
    for g in r.street_groups:
        for i in r.groups[g]:
            P = r.price[i]; T = T_value(gt,g,N); n=gt[g]["n"]
            row = dict(name=r.names[i], group=gt[g]["name"], price=P)
            for st,m in stage.items():
                row[st] = round(P*m)
            row["завершує мій"] = round(P + 0.5*T)
            row["блокує суперника"] = round(P + 0.35*gt[g]["Wper"])
            rows.append(row)
    for k in ("airport","utility"):
        for i in r.groups[k]:
            P=r.price[i]
            rows.append(dict(name=r.names[i], group=gt[k]["name"], price=P, **{"рання":round(P*1.15),"середня":P,"пізня":round(P*0.8)},
                             **{"завершує мій":round(P*1.45), "блокує суперника":round(P*1.15)}))
    return rows

def trade_tables(r, gt):
    Ns=[3,4,5,6]
    T = {g: {N: T_value(gt,g,N) for N in Ns} for g in r.street_groups}
    # макс. доплата за останню ділянку набору (покупець) і мінімальна ціна продавця
    buy = {}
    for g in r.street_groups:
        Pm = max(r.price[i] for i in r.groups[g])
        buy[g] = dict(Pm=Pm, max_pay={N: round(Pm+0.6*T[g][N]) for N in Ns}, ask=round(1.5*Pm+gt[g]["Wper"]))
    # обмін наборами 1<->1 (4 гравці): доплата = 1/2 (T_g - T_h)
    swap = {}
    for g in r.street_groups:
        for h in r.street_groups:
            swap[(g,h)] = round(0.5*(T[g][4]-T[h][4]))
    return T, buy, swap

def jail_analysis(r, gt, land):
    """Очікувана оренда за хід на дошці при типових пізніх станах + різниця потраплянь."""
    s_leave = stationary(r,"leave"); s_stay = stationary(r,"stay")
    # якщо в тюрмі сидіти: за хід у тюрмі ймовірність вийти дублем 1/6
    scen = []
    for desc, sets in [("1 набір суперника (Німеччина, 3 буд.)", [("germany",3)]),
                       ("2 набори (Німеччина 3 буд., Франція 3 буд.)", [("germany",3),("france",3)]),
                       ("3 набори з готелями (Італія, Китай, Британія)", [("italy",5),("china",5),("uk",5)])]:
        e = sum(gt[g]["inc"][lv] for g,lv in sets)
        scen.append((desc, e))
    return dict(land_leave=s_leave["land"], land_stay=s_stay["land"], jail_share_leave=s_leave["in_jail_turn_share"],
                jail_share_stay=s_stay["in_jail_turn_share"], scen=scen)

def run_all(r):
    st = {p: stationary(r,p) for p in ("leave","stay")}
    mc = {p: monte_carlo(r,p,400000,seed=7) for p in ("leave","stay")}
    land = st["leave"]["land"]
    gt = group_tables(r, land)
    return dict(st=st, mc=mc, gt=gt, auction=auction_table(r,gt), trade=trade_tables(r,gt), jail=jail_analysis(r,gt,land))
