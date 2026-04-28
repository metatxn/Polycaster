# Custom Wallet Menu — Design

Status: approved 2026-04-26
Owners: web team

## Problem

The connected-wallet account modal is currently rendered by `@reown/appkit`
(`useAppKit().open()`). It looks like an AppKit modal — orb avatar, hard-coded
"POL" label, generic Swap/Send/Activity row — none of which matches the
editorial system the rest of the platform follows. AppKit's theming surface
allows recoloring and one font family swap; it does NOT allow restructuring
the layout, replacing typographic treatments, or adding our trading-wallet
balance.

Replace the connected-account UI with a custom dropdown styled in the
editorial system. Keep AppKit for the disconnected flow (wallet selection,
WalletConnect QR, social logins).

## Out of scope

- Connect / wallet-selection flow (AppKit retains it)
- Multi-chain switcher (single Polygon for now)
- Withdraw / Send / Swap actions

## Component

A single `<WalletMenu>` React component used by all three nav surfaces
(`top-nav`, `navbar` mobile bar, `sidebar-mobile`). Uses the children
trigger-as-child pattern so each nav keeps its own button styling.

```tsx
<WalletMenu>
  <button>...wallet button styled to taste...</button>
</WalletMenu>
```

`WalletMenu` clones its child to attach the open/close click handler,
manages its own `isOpen` state, listens for outside clicks + Escape, and
renders the floating panel anchored to the trigger via absolute positioning
inside a `position: relative` wrapper.

No shadcn, no Radix. Plain React state + a `useEffect` for the global
listeners. The panel is conditionally rendered (no portal) so it scrolls
with the page if the parent moves; for our nav surfaces this is fine since
the wallet button lives in a sticky top bar.

## Layout (top → bottom)

1. **Header** — italic Fraunces 14px "Wallet" label
2. **Identity**
   - 36×36 avatar slot. ENS avatar when available, otherwise a 36×36
     square filled with `--knoww-text` and the K-mark glyph (parity
     with the brand mark).
   - ENS name (if any) as sans-bold 14px, address fallback when no ENS
   - Truncated address as a copy-on-click pill: mono tabular 11px, hover
     reveals a subtle background; click triggers `navigator.clipboard.writeText`
     and a brief sonner `toast.success`. Copying does NOT close the menu.
3. **Balances** — two rows separated by a hairline gradient divider
   - `POL` — mono uppercase 9px label + mono tabular 16px figure, right-
     aligned. Native balance via wagmi `useBalance({ address })`.
   - `PUSD` — same treatment. Source: trading wallet (proxy address) via
     existing `useProxyWallet()` hook + `useBalance` against the pUSD
     contract on Polygon.
4. **Actions** — flat rows, each: leading icon (16px, `text-muted-foreground`)
   + label (sans 14px) + trailing chevron-right (12px, muted)
   - **Deposit** — opens existing `<DepositModal>` (state lifted to
     `WalletMenu`'s local state)
   - **Portfolio** — `router.push("/portfolio")`, closes the menu
   - Hairline gradient divider
   - **Disconnect** — wagmi `useDisconnect()`, closes the menu
5. **Footer** — `POLYGON · MAINNET` mono uppercase 9px, opacity 0.5

## Behavior

| Event | Result |
|-------|--------|
| Click trigger button | Toggles `isOpen` |
| Click outside the menu | `isOpen = false` |
| Press Escape | `isOpen = false` |
| Click address pill | Copy to clipboard + toast; menu stays open |
| Click Deposit | Opens DepositModal; menu closes |
| Click Portfolio | Navigates; menu closes |
| Click Disconnect | wagmi disconnect; menu closes |

## Editorial typography mapping

| Surface | Treatment |
|---------|-----------|
| Header label | Fraunces italic 500, 14px |
| ENS / address fallback | Plus Jakarta Sans 600, 14px |
| Address copy pill | Mono 500, 11px, tabular-nums |
| Balance label (`POL`, `PUSD`) | Mono 500, 9px, uppercase, tracking 0.16em |
| Balance figure | Mono 500, 16px, tabular-nums |
| Action label | Plus Jakarta Sans 500, 14px |
| Footer chain context | Mono 500, 9px, uppercase, tracking 0.16em, opacity 0.5 |
| Hairline dividers | `linear-gradient(to right, transparent, border, transparent)` |

## Wiring

Three call sites, all conditional on `isConnected && address`:

- `top-nav.tsx` — replace the inline `<button onClick={() => open()}>` (the
  `isConnected` branch) with a `<WalletMenu>` wrapper around that same button.
- `navbar.tsx` — same swap on the mobile bar's wallet pill.
- `sidebar-mobile.tsx` — same swap inside the drawer header.

The disconnected-state `<button onClick={() => open()}>` stays untouched in
all three; AppKit's connect modal still handles wallet selection.

## Hooks

- `useAccount` (wagmi) — address, isConnected
- `useBalance` (wagmi) — POL native + pUSD ERC-20 balance against the
  proxy address
- `useEnsName`, `useEnsAvatar` (wagmi) — ENS display, mainnet chain id
- `useDisconnect` (wagmi) — disconnect button
- `useProxyWallet` (existing) — proxy address for trading-wallet pUSD
- `useRouter` (next/navigation) — Portfolio link
- `toast` (sonner) — copy confirmation

## Verification

- Manual desktop pass via chrome-devtools-mcp — open/close, click outside,
  escape, address copy, navigation, disconnect
- Manual mobile-viewport pass via chrome-devtools-mcp `resize_page` to
  390×844 — confirm the panel doesn't clip, tap targets are reasonable

## File layout

- `apps/web/src/components/wallet-menu.tsx` — single file. Inner subcomponents
  (`WalletMenuIdentity`, `WalletMenuBalances`, `WalletMenuActionRow`) live in
  the same file since they're not reused elsewhere.
