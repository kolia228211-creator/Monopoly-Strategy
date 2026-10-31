import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt, numpy as np
from matplotlib.patches import Rectangle
from .rules import GROUP_UA
plt.rcParams.update({"font.family":"DejaVu Sans","font.size":9,"axes.spines.top":False,"axes.spines.right":False,
                     "axes.grid":True,"grid.alpha":0.25,"figure.dpi":150})
GCOL = {"brazil":"#8B5A2B","israel":"#7EC8E3","italy":"#D94F9C","germany":"#F28C28","china":"#D62828",
        "france":"#E9C46A","uk":"#2A9D8F","usa":"#264796","airport":"#555555","utility":"#9AA5B1"}
SEQ = plt.get_cmap("YlOrRd")

def board_xy(i):
    """Координати клітинки на кільці 11x11: 0 — правий нижній кут, рух за годинниковою (як на richup: вліво по низу)."""
    if i<=10: return 10-i, 0
    if i<=20: return 0, i-10
    if i<=30: return i-20, 10
    return 10, 40-i

def heatmap(r, land, path, title):
    fig, ax = plt.subplots(figsize=(6.4,6.4)); ax.set_aspect("equal"); ax.axis("off")
    v = np.array(land)*100; lo, hi = v.min(), v.max()
    for i in range(40):
        x,y = board_xy(i); c = SEQ((v[i]-lo)/(hi-lo)*0.9+0.05)
        ax.add_patch(Rectangle((x,y),1,1,facecolor=c,edgecolor="white",lw=1.5))
        g = r.group[i]
        if g in GCOL: ax.add_patch(Rectangle((x,y+0.82),1,0.18,facecolor=GCOL[g],edgecolor="none"))
        nm = r.names[i].replace(" Airport","\nAirport").replace(" Company","\nCo.").replace("Prison / Passing by","Prison").replace("San Francisco","San\nFrancisco").replace("Earnings Tax","Earn.\nTax").replace("Premium Tax","Prem.\nTax").replace("Go to prison","Go to\nprison").replace("New York","New\nYork")
        ax.text(x+0.5,y+0.55,nm,ha="center",va="center",fontsize=4.6)
        ax.text(x+0.5,y+0.18,f"{v[i]:.2f}%",ha="center",va="center",fontsize=5.5,fontweight="bold")
    ax.text(5.5,5.9,title,ha="center",fontsize=10,fontweight="bold")
    ax.text(5.5,5.2,"очікувана к-сть потраплянь\nза один хід гравця, %",ha="center",fontsize=8)
    ax.text(5.5,4.2,f"мін {lo:.2f}%   макс {hi:.2f}%",ha="center",fontsize=8,color="#555")
    ax.set_xlim(-0.1,11.1); ax.set_ylim(-0.1,11.1)
    fig.savefig(path,bbox_inches="tight"); plt.close(fig)

def landing_bars(r, st, mc, path):
    fig, ax = plt.subplots(figsize=(8,3.2)); x=np.arange(40)
    ax.bar(x-0.2, st["leave"]["land"]*100, 0.4, label="Марков: виходити одразу", color="#2A6F97")
    ax.bar(x+0.2, st["stay"]["land"]*100, 0.4, label="Марков: сидіти в тюрмі", color="#A9D6E5")
    ax.plot(x-0.2, mc["leave"]*100, "k.", ms=3, label="Монте-Карло (перевірка)")
    ax.plot(x+0.2, mc["stay"]*100, "k.", ms=3)
    ax.set_xticks(x); ax.set_xticklabels([str(i) for i in x], fontsize=6); ax.set_ylabel("% за хід")
    ax.set_xlabel("номер клітинки"); ax.legend(fontsize=7, ncol=3, loc="upper left")
    fig.tight_layout(); fig.savefig(path); plt.close(fig)

def payback_chart(r, gt, path, N=4):
    fig, axs = plt.subplots(1,2,figsize=(8,3.3))
    lv = np.arange(6); labels=["0","1","2","3","4","готель"]
    for g in r.street_groups:
        d=gt[g]
        axs[0].plot(lv, np.array(d["inc"])*(N-1), marker="o", ms=3, color=GCOL[g], label=d["name"])
        axs[1].plot(lv, np.array(d["payback"])/(N-1), marker="o", ms=3, color=GCOL[g], label=d["name"])
    axs[0].set_title(f"Дохід набору за коло ({N} гравці), $"); axs[1].set_title(f"Окупність, кіл ({N} гравці)")
    for a in axs: a.set_xticks(lv); a.set_xticklabels(labels); a.set_xlabel("будинків на кожній ділянці")
    axs[1].set_ylim(0,60); axs[1].axvline(3,color="#999",ls="--",lw=0.8)
    axs[0].legend(fontsize=6.5, ncol=2)
    fig.tight_layout(); fig.savefig(path); plt.close(fig)

def strategy_chart(cells, names, path, prefix="main"):
    Ns=[3,4,5,6]; strs=[c["hero"] for c in cells if c["label"].startswith(prefix+"|") and c["n"]==4]
    fig, axs = plt.subplots(1,4,figsize=(9,3.8),sharey=True)
    for k,N in enumerate(Ns):
        ax=axs[k]; rows=[c for c in cells if c["label"].startswith(prefix+"|") and c["n"]==N]
        rows={c["hero"]:c for c in rows}; y=np.arange(len(strs))
        w=[rows[s]["win"]*100 for s in strs]; lo=[(rows[s]["win"]-rows[s]["lo"])*100 for s in strs]; hi=[(rows[s]["hi"]-rows[s]["win"])*100 for s in strs]
        cols=["#2A6F97" if rows[s]["win"]>=1/N else "#C8553D" for s in strs]
        ax.barh(y,w,xerr=[lo,hi],color=cols,ecolor="#333",capsize=2,height=0.65)
        ax.axvline(100/N,color="k",ls="--",lw=0.8); ax.set_title(f"{N} гравці" if N<5 else f"{N} гравців")
        ax.set_xlabel("шанс перемоги, %")
        ax.set_yticks(y); ax.set_yticklabels([names[s] for s in strs], fontsize=7)
        ax.invert_yaxis() if k==0 else None
    fig.tight_layout(); fig.savefig(path); plt.close(fig)

def seat_chart(cells, path):
    fig, ax = plt.subplots(figsize=(8,2.8))
    for k,N in enumerate([3,4,5,6]):
        c=[c for c in cells if c["label"]==f"seat|{N}"][0]
        x=np.arange(N)+k*7
        w=np.array([s[0] for s in c["seat"]])*100; lo=w-np.array([s[1] for s in c["seat"]])*100; hi=np.array([s[2] for s in c["seat"]])*100-w
        ax.bar(x,w,yerr=[lo,hi],color=plt.get_cmap("Blues")(np.linspace(0.85,0.35,N)),capsize=2)
        ax.hlines(100/N,x[0]-0.4,x[-1]+0.4,colors="k",linestyles="--",lw=0.8)
        ax.text(x.mean(),max(w)+6,f"{N} гравців",ha="center",fontsize=8)
    ax.set_xticks([i+k*7 for k,N in enumerate([3,4,5,6]) for i in range(N)])
    ax.set_xticklabels([str(i+1) for N in [3,4,5,6] for i in range(N)]); ax.set_xlabel("черговість ходу (1 = ходить першим)")
    ax.set_ylabel("шанс перемоги, %"); fig.tight_layout(); fig.savefig(path); plt.close(fig)

def marginal_chart(r, gt, path):
    fig, ax = plt.subplots(figsize=(8,2.9)); w=0.16
    for k,lv in enumerate(range(1,6)):
        vals=[min(gt[g]["marginal"][lv],60) for g in r.street_groups]
        ax.bar(np.arange(len(r.street_groups))+(k-2)*w, vals, w, label=["1-й буд.","2-й","3-й","4-й","готель"][k],
               color=plt.get_cmap("viridis")(k/5))
    ax.set_xticks(range(len(r.street_groups))); ax.set_xticklabels([gt[g]["name"] for g in r.street_groups])
    ax.set_ylabel("$ вкладень на 1 $ доходу\nза хід суперника"); ax.legend(fontsize=7,ncol=5)
    ax.set_title("Гранична «ціна за $ доходу» кожного рівня забудови (менше = краще)")
    fig.tight_layout(); fig.savefig(path); plt.close(fig)
