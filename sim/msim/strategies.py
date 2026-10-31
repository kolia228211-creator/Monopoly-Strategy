from .engine import strat
CHEAP = {"brazil","israel","italy","airport","utility"}
EXPENSIVE = {"france","uk","usa","airport"}
STRATEGIES = {
 "base":       ("Купівля + 3 будинки (база)", strat(name="base")),
 "aggressive": ("Агресивна купівля", strat(name="aggressive", reserve=0, bid_mult=1.3, early_mult=1.3, late_mult=1.0,
                                             target=5, build_reserve=0, extra_build_cash=0, kappa=0.9, complete_k=0.7)),
 "cheap":      ("Тільки дешеві групи", strat(name="cheap", allowed=CHEAP, target=5, build_reserve=100, extra_build_cash=200)),
 "orange":     ("Ставка на Німеччину (аналог помаранчевих)", strat(name="orange", focus={"germany","italy"}, focus_mult=1.6, kappa=0.9)),
 "expensive":  ("Тільки дорогі групи", strat(name="expensive", allowed=EXPENSIVE)),
 "passive":    ("Пасивна", strat(name="passive", reserve=400, buy_min_after=600, bid_mult=0.7, early_mult=1.0, late_mult=0.6,
                                 build_reserve=600, extra_build_cash=1000, trade=False)),
 "notrade":    ("База без торгів", strat(name="notrade", trade=False)),
 "jail_leave": ("База, з тюрми завжди платити", strat(name="jail_leave", jail="leave")),
 "jail_stay":  ("База, у тюрмі завжди сидіти", strat(name="jail_stay", jail="stay")),
 "max_hotel":  ("База, будувати одразу до готелю", strat(name="max_hotel", target=5, build_reserve=150, extra_build_cash=150)),
}
