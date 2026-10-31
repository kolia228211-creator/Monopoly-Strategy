"""Одна команда: аналітика + Монте-Карло + PDF.
   python3 sim/run_all.py              # повний прогін (4000 партій на клітинку)
   python3 sim/run_all.py --games 500  # швидко
   python3 sim/run_all.py --skip-mc    # лише перебудувати PDF з out/mc_results.json"""
import os, sys, json, argparse, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from msim.rules import Rules
from msim import analysis, report
from msim.strategies import STRATEGIES

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--games", type=int, default=4000); ap.add_argument("--skip-mc", action="store_true")
    a = ap.parse_args(); out = os.path.join(HERE, "out")
    if not a.skip_mc:
        subprocess.check_call([sys.executable, os.path.join(HERE,"run_mc.py"), "--games", str(a.games)])
    mc = json.load(open(os.path.join(out,"mc_results.json")))
    r = Rules(); A = analysis.run_all(r); A_off = analysis.run_all(r.with_(doubleRentOnFullSet=False))
    names = {k: v[0] for k,v in STRATEGIES.items()}
    pdf = report.build(r, A, A_off, mc, out, names)
    export_summary(r, A, mc, names, os.path.join(out, "summary.json"))
    print("PDF:", pdf)

def export_summary(r, A, mc, names, path):
    """Машинно-зчитуваний підсумок для браузерного помічника («мозок»)."""
    gt = A["gt"]; T, buy, swap = A["trade"]
    d = {"landingPerTurn": {"leave": list(map(float, A["st"]["leave"]["land"])), "stay": list(map(float, A["st"]["stay"]["land"]))},
         "groups": {g: {"income": gt[g]["inc"], "payback": gt[g]["payback"], "Wper25": gt[g]["Wper"], "T": T[g],
                        "maxPayLast4p": buy[g]["max_pay"][4], "sellerAsk": buy[g]["ask"]} for g in r.street_groups},
         "formulas": {"valuation": "V = P*m_stage (+0.5*T if completes mine) (+0.35*25*I3 if blocks one opponent); m=1.15/1.0/0.8",
                      "T": "T_g(N) = (N-1)*25*I3_g - 3*housePrice*n",
                      "buyerMaxPay": "P + 0.6*T_g(N), leave cash for >=1 house per lot",
                      "sellerAsk": "1.5*P + 25*I3*(1+0.5*(k-1))",
                      "swap": "0.5*(T_g - T_h) paid by the one receiving the more valuable set",
                      "jail": "leave if unowned>25% and no opponent set with >=2 houses; else stay"},
         "winRates": {c["label"]: {"win": c["win"], "lo": c["lo"], "hi": c["hi"]} for c in mc["cells"]}}
    json.dump(d, open(path,"w"), ensure_ascii=False, indent=1)

if __name__ == "__main__": main()
