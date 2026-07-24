# Sandoq — demo video script

A full product walkthrough (~2 min) for Level 5. **[SHOW]** is what's on screen,
**[SAY]** is the line to read. Speak slowly and let the Freighter pop-ups appear on
camera — the signatures are the proof of real wallet interactions.

Live app: <https://itsgriznft.github.io/sandoq/> · Pitch deck: <https://itsgriznft.github.io/sandoq/pitch.html>

---

## 1 · The problem — 0:00–0:15

**[SHOW]** The Sandoq home page.

**[SAY]**
> "This is Sandoq. All over the world people save in rotating circles — a group puts in a fixed
> amount each round, and the whole pot goes to one member at a time until everyone's been paid.
> It's called esusu, chit fund, tanda — in Iran, sandoq. But they run on trust: the organizer can
> run off with the pot. Sandoq moves that trust into a smart contract on Stellar."

## 2 · The product, live — 0:15–0:30

**[SHOW]** Scroll the home page: stats bar, circle cards, live activity feed.

**[SAY]**
> "Everything here is read live from the blockchain — the stats, every circle, and this activity
> feed. Nobody, not even me, holds the money. The contract escrows every stake and pays every pot."

## 3 · Onboarding — anyone can start — 0:30–0:45

**[SHOW]** Click **New here?** → the four-step guide.

**[SAY]**
> "For someone who's never used a wallet, there's a guided setup: install Freighter, get free
> testnet XLM, connect, and join — four steps, about two minutes. Onboarding is the whole game, so
> we made it frictionless."

## 4 · Connect & join a circle — 0:45–1:10

**[SHOW]** Connect wallet → Freighter → Approve. Open a **Filling** circle → **Join** → sign in
Freighter → the seat appears in the grid.

**[SAY]**
> "Let me join one. I connect Freighter, pick an open circle, and press Join — that stakes a small,
> refundable collateral. I sign… and that's a real transaction on Stellar testnet. My seat is now
> on-chain, in the payout order."

## 5 · A running circle + the reminder — 1:10–1:35

**[SHOW]** Open a **running** circle. Point at the seat grid (paid / due / next-payout, a
*received* badge), then the **⏰ round countdown reminder** ticking down.

**[SAY]**
> "Here's a circle mid-rotation. The seats are the payout order — you can see who's paid, who's due,
> who's next, and this member already received their round's pot on-chain. Users asked for a nudge
> before a round closes, so there's now a live countdown and a reminder of exactly what you owe. A
> missed round is covered from that member's own stake first."

## 6 · On-chain feedback — 1:35–1:50

**[SHOW]** Footer → **Give feedback** → rating + role → sign → it appears in the Community list.

**[SAY]**
> "Feedback is on-chain too. I rate it and sign, and it's a public, verifiable record — the summary
> here is read straight from the contract. Every change we ship traces back to feedback like this."

## 7 · Trust model + close — 1:50–2:05

**[SHOW]** Footer → **Analytics** (on-chain metrics + event stream). Optionally open a transaction
on Stellar Expert.

**[SAY]**
> "There's a built-in analytics and monitoring panel, and everything Sandoq does is a real
> transaction you can trace on the ledger. Sandoq doesn't create trust between strangers — it
> removes the need for a trusted organizer. The savings circle you already know, made unbreakable.
> Thanks for watching."

---

### Recording notes

- Have the app open, Freighter unlocked on Testnet, and a funded account before you start.
- Open circles are ready to join; a running circle (with a paid-out round) is ready for section 5.
- For the reminder in section 5 to show *your* countdown, be a member of that circle; otherwise just
  point at the round countdown in the header.
- If a step fails, just retry — every action is idempotent from the UI's point of view.
- Under two-and-a-half minutes is ideal. Sections 3–6 are the core; 1–2 and 7 are the frame.
