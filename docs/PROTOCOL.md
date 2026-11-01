# Протокол richup.io (розвідка 01.11.2026)

Зібрано в живій приватній кімнаті з ботами через Chrome. Цього достатньо, щоб помічник читав гру без записувача.

## Транспорт

- Socket.IO v4 (Engine.IO, текстовий JSON), WebSocket `wss://richup.io/api/game/socket.io/`.
- Простори імен: `/api/game` (гра), `/api/lobby` (список кімнат), `/api/app` (акаунт).
- Формат: `42/api/game,<ackId?>["подія",{...}]`; відповідь на ack: `43/api/game,<ackId>[{"ok":true,...}]`.
- Сторінка: React + TanStack Router, без CSP-заголовка (CDN-скрипти дозволені).

## Найпростіший спосіб читати стан: Zustand-сховище

Клієнт тримає **повний живий стан кімнати** у Zustand-сховищі (`getState / setState / subscribe`), до якого веде хук React-компонента сторінки гри.

```js
store.getState() = {
  state: { id, phase, participants[], currentPlayerIndex, mapId, blocks[40], boardConfig, dice,
           cubesRolledInTurn, canPerformTurnActions, doublesInARow, auction, trades[], bonusCards,
           vacationCash, settings, turnClock, hostId, winnerId, stats },
  selfParticipantId,            // хто я
  applyServerAction, syncState, // клієнт застосовує дельти від сервера
  logs, animation, isOnline, ...
}
```

Пошук: обійти дерево React-fiber від `#app` і знайти `memoizedState`, у якого є `getState()`, що повертає `{state:{participants, blocks}}`. Далі `store.subscribe(fn)` викликає нас на кожну зміну, і жодних дельт розбирати не треба.

### Гравець (`participants[i]`)
`id, name, appearance, isBot, teamId, position, money, bankruptedAt, debtTo, connectivity, clock{bankMs, autoActedTurns, turnsTaken}`

### Клітинка (`blocks[i]`)
- `city`: `name, countryId, price, housePrice, hotelPrice, rentPrices{0..5}, level(0-5), ownerId, isMortgaged`
- `airport`: `price, rentPrices[4], ownerId, isMortgaged`
- `company`: `companyType: electricity|water, price, ownerId, isMortgaged`
- `bonus`: `bonusType: treasure|surprise|tax|premium-tax` (`taxPercentage` / `taxAmount`)
- `corner`: `go|prison|vacation|go-to-prison` (`suspensionAmount`, `suspendedTurnsRemaining{playerId: n}`)

### Аукціон (`state.auction`)
`{ blockIndex, currentBid, currentBidderId, bidderIds[], state: "active"|"ended", endsAt }`

### `boardConfig`
`{ goReward: { land: 300, pass: 200 }, prisonBlockIndex: 10, goToPrisonBlockIndex: 30, vacationBlockIndex: 20 }`

## Події сервер → клієнт (бачені наживо)
`entered-room` (повний стан), `game-room-updated` (дельта налаштувань), `player-joined`, `player-left`, `joined-game`, `game-started`, `dice-rolled {dice, snapshot}`, `purchase-success {blockIndex}`, `auction-started {blockIndex}`, `auction-bade {amount, bidderId, endsAt}`, `turn-ended`, `sync-game-state`.

## Команди клієнт → сервер (з коду гри)
`enter-room {roomId}`, `join-game {name, appearance, captchaToken}`, `update-game-room {...налаштування}`, `start-game`, `plz-roll-dices`, `buy-property`, `start-auction`, `place-bid`, `end-turn`, `pay-out-of-prison`, `use-pardon-card`, `mortgage-property`, `unmortgage-property`, `upgrade-city`, `downgrade-city`, `sell-property`, `propose-trade`, `accept-trade`, `reject-trade`, `cancel-trade`, `send-chat-message`, `player-bankrupt`, `clock-grant-time`, `request-server-time`.

Помічник **нічого не надсилає**: він лише читає стан і показує поради. Натискає завжди людина.

## Помічені правила richup (відмінності від класики)
- START: **+$300 за точне потрапляння**, +$200 за проходження.
- **Vacation забирає 1 хід** (`suspensionAmount: 1`), а з Vacation cash віддає накопичене.
- Ціна готелю дорівнює ціні будинку.
- У колодах по 17 карток (є «Pardon» — вихід з тюрми).
- Аукціон: кнопки +$2 / +$10 / +$100, таймер ~10 с, що скидається після кожної ставки. Боти переплачують: Jerusalem ($120) пішов за $144.
- `stampedFlags.tradeFairnessRules: true`: сервер має обмеження на «нечесні» обміни (подробиці ще треба з'ясувати).
- Таймер ходу: 20 с grace + банк 60–180 с.

Точні ціни, оренди та картки лежать у `data/board-classic.json`.
