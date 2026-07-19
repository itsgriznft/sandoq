# Sandoq — demo video script (~90 seconds)

For each section: **[SHOW]** is what's on screen, **[SAY]** is the line to read.
Speak slowly and let the Freighter pop-ups appear on camera — the signatures are
the proof of real wallet interactions. Live app: <https://itsgriznft.github.io/sandoq/>

---

## 1 · The problem — 0:00–0:15

**[SHOW]** The Sandoq home page.

**[SAY]**
> "This is Sandoq. All over the world people save in rotating circles — a group
> puts in a fixed amount every round, and the whole pot goes to one member at a
> time until everyone has been paid once. It's called esusu, chit fund, tanda —
> in Iran, sandoq. But these circles run on trust: the organizer can run off with
> the pot, and there's no referee. Sandoq moves that trust into a smart contract
> on Stellar."

## 2 · The product — 0:15–0:30

**[SHOW]** Scroll the home page: the stats bar, the circle cards, the live activity feed.

**[SAY]**
> "Everything here is read live from the blockchain — the stats, every circle, and
> this activity feed. Nobody, not even me, holds the money. The contract escrows
> every stake and pays out every pot."

## 3 · A running circle — 0:30–0:50

**[SHOW]** Open a running circle. Point at the seat grid and the activity feed.

**[SAY]**
> "Here's a live circle mid-rotation. The seats are the payout order. You can see
> who's paid, who's due, and who's next. The pot for the first round was already
> paid out on-chain, so this member is marked 'received'. And if someone misses a
> round, it's covered from their own collateral first — so the person receiving is
> always made whole."

## 4 · Trust, in one line — 0:50–1:00

**[SHOW]** Stay on the circle; point at the stake amount in the header.

**[SAY]**
> "That collateral is the whole trust model. Sandoq doesn't create trust between
> strangers — it removes the need for a trusted organizer. Friends stake a little;
> strangers stake more. Either way, no one can run off with the pot."

## 5 · Connect and join — 1:00–1:20

**[SHOW]** Back to all circles → Connect wallet → Freighter → Approve. Open a circle
marked "Filling" → Join → sign in Freighter → the seat appears.

**[SAY]**
> "Let me join one. I connect my Freighter wallet, pick an open circle, and press
> Join — that stakes a small, refundable collateral. I sign… and that's a real
> signed transaction on Stellar testnet. My seat is now on-chain."

## 6 · On-chain feedback — 1:20–1:35

**[SHOW]** Footer → Give feedback → pick an emoji and a role → sign → it appears in
the Community feedback list.

**[SAY]**
> "Even feedback is on-chain. I rate it and sign, and it becomes a public,
> verifiable record. This community summary is read straight from the contract —
> no made-up numbers. You can check every response yourself on Stellar Expert."

## 7 · Monitoring and close — 1:35–1:50

**[SHOW]** Footer → Analytics (on-chain metrics + event stream). Optionally open a
transaction on Stellar Expert.

**[SAY]**
> "There's a built-in analytics and monitoring panel too. Everything Sandoq does is
> a real transaction you can trace on the ledger — traditional savings circles, with
> the trust replaced by code. Thanks for watching."

---

### Recording notes

- Have the app open, Freighter unlocked on Testnet, and a funded account before you start.
- Two open circles are ready to join (Pilot, Community); one is running (Neighbors) for section 3.
- If a step fails, just retry — every action is idempotent from the UI's point of view.
- Keep it under two minutes; sections 3–6 are the core, 1–2 and 7 are the frame.
