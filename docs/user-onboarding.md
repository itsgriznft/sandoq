# User onboarding & feedback collection

This is the playbook for onboarding real testnet users and collecting their feedback for
Level 5. Two pieces: a **Google Form** (records who used it) and **outreach copy** (brings them in).

---

## 1. The Google Form (2 minutes to create)

Create a form at [forms.google.com](https://forms.google.com) with these questions. Keep it short —
every extra field costs completions.

| # | Question | Type | Required |
|---|---|---|---|
| 1 | Your name | Short answer | Yes |
| 2 | Email | Short answer (email validation) | Yes |
| 3 | Your Stellar **testnet** wallet address (starts with G…) | Short answer | Yes |
| 4 | How would you rate Sandoq? | Linear scale 1–5 | Yes |
| 5 | What did you do? | Multiple choice: *Started a circle · Joined a circle · Just explored* | Yes |
| 6 | What would make it better? | Paragraph | No |
| 7 | Can we contact you for the next version? | Yes / No | No |

**Form settings:** turn on *Collect email addresses*, and *Limit to 1 response* off (people may use
two wallets). Add a one-line description:

> Sandoq is a savings-circle app on the Stellar testnet. Connect a wallet, join a circle, then tell
> us how it went. Testnet only — no real money.

### Export responses to Excel

1. In the form, open the **Responses** tab → the green Sheets icon → *Create spreadsheet*.
2. In the sheet: **File → Download → Microsoft Excel (.xlsx)**.
3. Save it as `docs/user-feedback.xlsx` in this repo and commit it. The README already links there.
4. Re-export and re-commit as more responses come in — the commit history itself is the proof of a
   growing cohort.

---

## 2. Getting to 50 real users

50 is reachable in a week or two of real outreach. "User" means a real person — friends, family,
classmates, community members, and other builders all count. Ranked by speed:

1. **The RiseIn builder cohort** — the fastest. Hundreds of builders already have testnet wallets.
   Offer to try theirs if they try yours; post in the program's Discord/Telegram.
2. **Friends, family, classmates** — 15–20 people, walked through the in-app *New here?* guide.
3. **Stellar & crypto communities** — the Stellar Discord, local crypto Telegram groups.
4. **Diaspora groups** — the sharpest fit: families who already run circles across borders.
5. **One X/Twitter thread** — "I built a savings-circle dApp on Stellar testnet, try it in 2 min."

Point everyone at the **New here?** button on the site — it walks a first-timer from installing
Freighter to a first on-chain join.

---

## 3. Outreach copy (copy-paste, edit freely)

**RiseIn cohort (Discord/Telegram):**

> Hey builders 👋 I'm on Level 5 with **Sandoq** — rotating savings circles (ROSCAs) on Stellar
> testnet, where a smart contract holds the pot so no organizer can run off with it. Takes ~2 min
> to try: connect Freighter (testnet), join a circle, done. Would love your feedback — happy to
> test yours back!
> App: https://itsgriznft.github.io/sandoq/ · 1-min form: <FORM LINK>

**Friends / family (WhatsApp/Telegram):**

> Salam! I built an app for online savings circles (sandoq) and need a few people to test it. It's
> free play-money on a test network — no real funds, nothing to lose. The site has a "New here?"
> button that walks you through it in 2 minutes. Could you try it and fill the 1-minute form after?
> 🙏
> https://itsgriznft.github.io/sandoq/

**X / Twitter:**

> Built **Sandoq** on @StellarOrg testnet 🪙 — the age-old savings circle (sandoq / esusu / tanda),
> but a smart contract holds the pot so nobody can run off with it.
> Try it in 2 min 👇 (testnet, no real money)
> https://itsgriznft.github.io/sandoq/

---

## 4. What counts as "active usage" (for the proof)

The submission asks for real transaction activity. Each of these is an on-chain, verifiable tx:

- **Joining a circle** (stakes collateral) — the main onboarding action.
- **Contributing** to a round.
- **Settling** a round (permissionless — anyone can).
- **Leaving on-chain feedback** (a signed tx to the feedback contract).

The site's **Analytics** panel and the factory's `stats()` both surface counts you can screenshot;
Stellar Expert shows every transaction per address.
