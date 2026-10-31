"""Серії партій Монте-Карло. Схема «герой проти поля»: 1 гравець зі стратегією S, решта — база.
Місце героя випадкове (Randomize player order ON)."""
import random, math, zlib, multiprocessing as mp
from .rules import Rules
from .engine import Game, Precomp
from .strategies import STRATEGIES

def wilson(k, n, z=1.96):
    if n==0: return (0,0,0)
    p=k/n; d=1+z*z/n; c=(p+z*z/(2*n))/d; h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return (p, max(0,c-h), min(1,c+h))

_R = {}
def _get(over):
    key = tuple(sorted(over.items()))
    if key not in _R:
        r = Rules(); r = r.with_(**over) if over else r
        _R[key] = (r, Precomp(r))
    return _R[key]

def _job(args):
    over, hero, n, seed0, games, field, vacation = args
    r, pre = _get(over)
    wins=0; rounds=0; timeouts=0; seat_wins=[0]*n; hero_vac=0; tot_vac=0; trades=0; shortage=0
    for k in range(games):
        rng = random.Random(seed0*1000003+k)
        seat = rng.randrange(n)
        S = [STRATEGIES[field][1]]*n
        if hero: S = list(S); S[seat] = STRATEGIES[hero][1]
        res = Game(r, pre, S, rng, vacation=vacation).play()
        w = res["winner"]; seat_wins[w]+=1
        wins += (w==seat); rounds += res["rounds"]; timeouts += res["timeout"]
        hero_vac += res["vac"][seat]; tot_vac += sum(res["vac"]); trades += res["trades"]; shortage += res["shortage"]>0
    return dict(wins=wins, games=games, rounds=rounds, timeouts=timeouts, seat_wins=seat_wins,
                hero_vac=hero_vac, tot_vac=tot_vac, trades=trades, shortage=shortage)

def run(cells, games, chunks=8, procs=2):
    """cells: список (label, over, hero, n, field, vacation)."""
    jobs=[]; idx=[]
    for ci,(label,over,hero,n,field,vac) in enumerate(cells):
        per = games//chunks
        for c in range(chunks):
            jobs.append((over,hero,n,zlib.crc32(f"{label}|{c}".encode())%100000+c,per,field,vac)); idx.append(ci)
    with mp.Pool(procs) as pool: outs = pool.map(_job, jobs, chunksize=1)
    agg = {}
    for ci,o in zip(idx,outs):
        a = agg.setdefault(ci, None)
        if a is None: agg[ci]=o
        else:
            for k in o:
                if isinstance(o[k], list): a[k]=[x+y for x,y in zip(a[k],o[k])]
                else: a[k]+=o[k]
    res=[]
    for ci,(label,over,hero,n,field,vac) in enumerate(cells):
        a=agg[ci]; g=a["games"]
        p,lo,hi = wilson(a["wins"],g)
        res.append(dict(label=label, hero=hero, n=n, field=field, over=over, vacation=vac, games=g, win=p, lo=lo, hi=hi,
                        rounds=a["rounds"]/g, timeout=a["timeouts"]/g, seat=[wilson(x,g) for x in a["seat_wins"]],
                        hero_vac=a["hero_vac"]/g, tot_vac=a["tot_vac"]/g, trades=a["trades"]/g, shortage=a["shortage"]/g))
    return res
