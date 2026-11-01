"""Марковський ланцюг потрапляння на клітинки + перевірка Монте-Карло."""
import numpy as np, random
from collections import defaultdict
DICE = [(a,b) for a in range(1,7) for b in range(1,7)]

def _nearest(r, pos, kind):
    lst = r.airports if kind=="airport" else r.utilities
    for k in range(1,41):
        if (pos+k)%40 in lst: return (pos+k)%40

def resolve(r, pos, depth=0):
    """Після потрапляння на pos: список (ймовірність, кінцева_позиція, в_тюрму, [клітинки_потрапляння])."""
    t = r.types[pos]
    if t == "gotoprison": return [(1.0, r.jail, True, [pos])]
    if t in ("surprise","treasure") and depth < 3:
        deck = r.cards[t]; n = len(deck); out = []
        for c in deck:
            p = 1.0/n
            if c["t"]=="move": dest=c["to"]
            elif c["t"]=="nearest": dest=_nearest(r,pos,c["kind"])
            elif c["t"]=="back": dest=(pos-c["steps"])%40
            elif c["t"]=="jail": out.append((p, r.jail, True, [pos])); continue
            else: out.append((p,pos,False,[pos])); continue
            for (q,fp,j,l) in resolve(r,dest,depth+1):
                out.append((p*q,fp,j,[pos]+l))
        return out
    return [(1.0,pos,False,[pos])]

def build_chain(r, jail_policy="leave"):
    """Стани: (pos,d) d=0..2 дублів у цьому ході -> індекс pos*3+d; тюрма k=0..2 -> 120+k.
    Повертає матрицю переходів P, матрицю очікуваних потраплянь L (стан x клітинка) і маску початку ходу."""
    vs = bool(getattr(r, "vac_skip", 0)) and r.vacation is not None
    S = 124 if vs else 123; P = np.zeros((S,S)); L = np.zeros((S,40)); start = np.zeros(S, bool)
    res = {p: resolve(r,p) for p in range(40)}
    def nxt(fp, d, dbl):
        """Стан після потрапляння на fp (без тюрми)."""
        if vs and fp == r.vacation: return 123          # Vacation: хід завершено, наступний пропускаємо
        return fp*3+d+1 if dbl else fp*3
    for st in range(S):
        if st < 120:
            pos, d = divmod(st,3); start[st] = (d==0)
            for a,b in DICE:
                pr = 1/36; dbl = a==b
                if dbl and d==2:
                    P[st,120] += pr; continue
                for q,fp,j,l in res[(pos+a+b)%40]:
                    for x in l: L[st,x] += pr*q
                    if j: P[st,120] += pr*q
                    else: P[st, nxt(fp,d,dbl)] += pr*q
        elif st == 123:                     # пропущений хід на Vacation
            start[st] = True; P[st, r.vacation*3] = 1.0
        else:
            k = st-120; start[st] = True
            if jail_policy == "leave":   # платимо й кидаємо як звичайно
                P[st] = P[r.jail*3]; L[st] = L[r.jail*3]
                continue
            for a,b in DICE:
                pr = 1/36; dbl = a==b
                if not dbl and k<2: P[st,121+k] += pr; continue
                for q,fp,j,l in res[(r.jail+a+b)%40]:
                    for x in l: L[st,x] += pr*q
                    P[st, 120 if j else nxt(fp,0,False)] += pr*q
    # рядок 'leave' посилається на рядок jail*3, який рахується раніше (st<120) — ок.
    return P, L, start

def stationary(r, jail_policy="leave"):
    P, L, start = build_chain(r, jail_policy)
    w, v = np.linalg.eig(P.T)
    pi = np.real(v[:, np.argmin(abs(w-1))]); pi = pi/pi.sum()
    turns = pi[start].sum()
    land = (pi @ L) / turns               # очікувані потрапляння на клітинку за хід гравця
    in_jail = pi[120:123].sum()/turns        # частка ходів, що починаються в тюрмі
    # частка 'часу' (за кидками) на кожній клітинці, тюрма окремо
    occ = np.zeros(41)
    for st in range(120): occ[st//3] += pi[st]
    occ[40] = pi[120:123].sum()
    if len(pi) > 123: occ[r.vacation] += pi[123]
    return {"land": land, "in_jail_turn_share": in_jail, "occupancy": occ, "rolls_per_turn": 1/turns}

def monte_carlo(r, jail_policy="leave", turns=400000, seed=1):
    rng = random.Random(seed); land = np.zeros(40)
    surprise = list(range(len(r.cards["surprise"]))); treasure = list(range(len(r.cards["treasure"])))
    pos, jail_k, skip = 0, -1, 0
    vs = bool(getattr(r, "vac_skip", 0)) and r.vacation is not None
    def land_at(p, depth=0):
        land[p] += 1
        t = r.types[p]
        if t=="gotoprison": return None
        if t in ("surprise","treasure") and depth<3:
            c = r.cards[t][rng.randrange(len(r.cards[t]))]
            if c["t"]=="move": return land_at(c["to"],depth+1)
            if c["t"]=="nearest": return land_at(_nearest(r,p,c["kind"]),depth+1)
            if c["t"]=="back": return land_at((p-c["steps"])%40,depth+1)
            if c["t"]=="jail": return None
        return p
    for _ in range(turns):
        if skip: skip = 0; continue
        if jail_k >= 0:
            if jail_policy=="leave": jail_k=-1; pos=r.jail
            else:
                a,b = rng.randint(1,6), rng.randint(1,6)
                if a!=b and jail_k<2: jail_k+=1; continue
                jail_k=-1; np_ = land_at((r.jail+a+b)%40)
                if np_ is None: jail_k=0
                else:
                    pos=np_
                    if vs and pos==r.vacation: skip=1
                continue
        d=0
        while True:
            a,b = rng.randint(1,6), rng.randint(1,6)
            if a==b and d==2: jail_k=0; break
            np_ = land_at((pos+a+b)%40)
            if np_ is None: jail_k=0; break
            pos=np_
            if vs and pos==r.vacation: skip=1; break
            if a!=b: break
            d+=1
    return land/turns
