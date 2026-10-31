"""Запуск усіх серій Монте-Карло -> out/mc_results.json.  python3 sim/run_mc.py [--games 4000]"""
import json, os, sys, time, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from msim.experiments import run
from msim.strategies import STRATEGIES

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--games", type=int, default=4000); ap.add_argument("--procs", type=int, default=os.cpu_count() or 2)
    a = ap.parse_args(); G = a.games; t=time.time()
    main_strats = ["base","aggressive","cheap","orange","expensive","passive","notrade","jail_leave","jail_stay","max_hotel"]
    cells = []
    for n in (3,4,5,6):
        for s in main_strats: cells.append((f"main|{s}|{n}", {}, s, n, "base", None))
    for n in (3,4,5,6):
        for s in ["base","aggressive","cheap","orange","notrade","max_hotel"]:
            cells.append((f"x2off|{s}|{n}", {"doubleRentOnFullSet": False}, s, n, "base", None))
    for n in (3,4,5,6):
        cells.append((f"seat|{n}", {}, None, n, "base", None))           # уся таблиця = база, рахуємо місця
        cells.append((f"novac|{n}", {}, None, n, "base", False))         # vacation cash вимкнено
        cells.append((f"worldnotrade|{n}", {}, None, n, "notrade", None))
    res = run(cells, G, chunks=8, procs=a.procs)
    out = {"games_per_cell": G, "seconds": time.time()-t, "cells": res}
    os.makedirs(os.path.join(os.path.dirname(__file__),"out"), exist_ok=True)
    json.dump(out, open(os.path.join(os.path.dirname(__file__),"out","mc_results.json"),"w"), ensure_ascii=False, indent=1)
    print("done", time.time()-t)
if __name__ == "__main__": main()
