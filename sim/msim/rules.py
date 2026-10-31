import json, os, copy
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GROUP_ORDER = ["brazil","israel","italy","germany","china","france","uk","usa"]
GROUP_UA = {"brazil":"Бразилія","israel":"Ізраїль","italy":"Італія","germany":"Німеччина",
            "china":"Китай","france":"Франція","uk":"Британія","usa":"США",
            "airport":"Аеропорти","utility":"Комунальні"}
CLASSIC_ANALOG = {"brazil":"коричневі","israel":"блакитні","italy":"рожеві","germany":"помаранчеві",
                  "china":"червоні","france":"жовті","uk":"зелені","usa":"сині"}

class Rules:
    def __init__(self, cfg_path=None, overrides=None):
        cfg_path = cfg_path or os.path.join(ROOT, "sim", "config", "rules.json")
        cfg = json.load(open(cfg_path, encoding="utf-8"))
        if overrides: cfg.update(overrides)
        self.cfg = cfg
        board = json.load(open(os.path.join(ROOT, cfg["boardFile"]), encoding="utf-8"))
        self.board = board
        self.rents_from_board = False
        self.sq = board["squares"]
        assert len(self.sq) == 40
        self.names = [s["name"] for s in self.sq]
        self.types = [s["type"] for s in self.sq]
        self.price = [s.get("price", 0) for s in self.sq]
        self.group = [s.get("group") or (s["type"] if s["type"] in ("airport","utility") else None) for s in self.sq]
        self.rent = [None]*40
        ver = board.get("verified", {}).get("rents")
        for i,s in enumerate(self.sq):
            if s["type"] == "street":
                r = cfg["streetRents"][str(i)]
                if ver and s.get("rent"):
                    r = s["rent"]; self.rents_from_board = True
                self.rent[i] = list(r)
        self.house_price = [cfg["housePrice"].get(self.group[i], 0) if self.types[i]=="street" else 0 for i in range(40)]
        for i,s in enumerate(self.sq):
            if ver and s.get("housePrice"): self.house_price[i] = s["housePrice"]
        self.groups = {}
        for i,g in enumerate(self.group):
            if g: self.groups.setdefault(g, []).append(i)
        self.street_groups = [g for g in GROUP_ORDER if g in self.groups]
        self.airports = self.groups.get("airport", [])
        self.utilities = self.groups.get("utility", [])
        self.ownable = [i for i in range(40) if self.types[i] in ("street","airport","utility")]
        self.cards = cfg["cards"]
        self.jail = self.types.index("prison")
        self.gotojail = self.types.index("gotoprison")
        self.vacation = self.types.index("vacation") if "vacation" in self.types else None
        self.x2 = bool(cfg["doubleRentOnFullSet"])
        self.airport_rent = cfg["airportRent"]
        self.util_mult = cfg["utilityMultipliers"]
        self.fine = cfg["prison"]["fine"]
    def with_(self, **kw):
        r = copy.copy(self); r.cfg = dict(self.cfg); r.cfg.update(kw)
        if "doubleRentOnFullSet" in kw: r.x2 = bool(kw["doubleRentOnFullSet"])
        return r
    def street_rent(self, i, level, full_set):
        """level: 0..5 (5 = готель)."""
        r = self.rent[i][level]
        if level == 0 and full_set and self.x2: r *= 2
        return r
