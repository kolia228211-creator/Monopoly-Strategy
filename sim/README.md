# sim/ — математика Монополії для richup.io (Classic)

Марковський ланцюг потрапляння на клітинки + Монте-Карло-симулятор партій + PDF-звіт українською.

```bash
python3 sim/run_all.py              # усе: аналітика, ~300 тис. партій (≈20–25 хв на 2 ядрах), PDF
python3 sim/run_all.py --games 500  # швидкий прогін
python3 sim/run_all.py --skip-mc    # лише перебудувати PDF з out/mc_results.json
```

Результати: `sim/out/monopoly-math-report.pdf`, `sim/out/mc_results.json`, `sim/out/summary.json`
(машинно-зчитуваний «мозок» для помічника: ймовірності, дохід груп, формули, шанси стратегій).

## Правила
Усі числа — у `sim/config/rules.json` (поле `status`: що точне, що заглушка).
Заглушки (оренди, будинки, картки, START, тюрма) взято з класичної US-Монополії, оренди масштабовано за ціною.
Реальні оренди можна вписати в `rules.json` або в `data/board-classic.json` (`verified.rents: true`,
поля `rent: [0,1,2,3,4,готель]`, `housePrice`) — симулятор візьме їх автоматично.
`make_placeholder_config.py` відновлює заглушки.

## Модулі
- `msim/rules.py` — завантаження дошки й правил
- `msim/markov.py` — ланцюг на 123 стани, стаціонарний розподіл, перевірка МК
- `msim/analysis.py` — дохід/окупність груп, аукціон, обмін, тюрма
- `msim/engine.py` — партія: аукціони, застава, будинки, картки, vacation cash, торги
- `msim/strategies.py` — набори параметрів стратегій
- `msim/experiments.py` — серії партій, інтервали Вільсона
- `msim/charts.py`, `msim/report.py` — графіки й PDF
