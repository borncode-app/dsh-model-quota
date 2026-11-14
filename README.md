> **This repository has moved into one monorepo.**
>
> The whole MiniMax set — the credit proxy, the daily check-in, the model-list
> sync, the composer quota chip, the MiniMax Code bridge, and the shared grant
> reader — now lives in
> **[`borncode-app/dsh-minimax-kit`](https://github.com/borncode-app/dsh-minimax-kit)**,
> one repository with one Plugins entry.
>
> | this repo | new home |
> |---|---|
> | `dsh-minimax-auth` | `packages/dsh-minimax-auth` |
> | `dsh-minimax-credit` | `packages/dsh-minimax-credit` |
> | `dsh-minimax-checkin` | `packages/dsh-minimax-checkin` |
> | `dsh-minimax-model-sync` | `packages/dsh-minimax-model-sync` |
> | `dsh-minimax-bridge` | `packages/dsh-minimax-bridge` |
> | `dsh-model-quota` | `packages/dsh-model-quota` |
>
> The code and its history are unchanged; only the repository is shared. Install
> `dsh-minimax-kit` instead of the individual bundles. This repository stays
> open so the old links keep working.
<div align="center">
  <img src="icon.svg" alt="" width="72" height="72">
  <h1>dsh-model-quota</h1>
  <p><b>The selected model's remaining rate limit or balance, right under the composer.</b></p>
  <p>
    <a href="https://github.com/borncode-app/dsh-model-quota/releases"><img alt="release" src="https://img.shields.io/github/v/release/borncode-app/dsh-model-quota?style=flat-square&color=6C4BF6"></a>
    <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-3DA639?style=flat-square"></a>
    <img alt="plugin" src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-6C4BF6?style=flat-square">
    <img alt="providers" src="https://img.shields.io/badge/providers-4-8957e5?style=flat-square">
  </p>
</div>

---

## Where the MiniMax kit ships it

This plugin is provider-agnostic â€” it stays installable on its own, and it
supports DeepSeek and Claude providers too. It is also published inside
**[`dsh-minimax-kit`](https://github.com/borncode-app/dsh-minimax-kit)**,
because its `minimax-coding-plan` probe reads the same endpoint as the credit
proxy. Install the kit if you want the whole MiniMax set from a single
**Plugins** entry; the code here is unchanged.

## What it does

Every provider hides its remaining quota somewhere different â€” a coding-plan window, an account wallet, a
5-hour subscription bucket. This plugin turns whichever one applies to the **currently selected model** into one
chip under the composer, so "how much is left" is a glance instead of a dashboard visit.

Four probe kinds are built in, and a provider you do not list simply shows nothing:

| kind | reports |
|---|---|
| `minimax-coding-plan` | MiniMax coding plan: current window **and** weekly percentages remaining |
| `deepseek-account-balance` | DeepSeek Platform account wallet balances (from the signed-in credential record) |
| `deepseek-api-balance` | DeepSeek API-key balance, for an API-key route |
| `claude-oauth-usage` | Claude Pro/Max windows: 5-hour, weekly, extra usage |

## Features

- **Follows the model** â€” switch model, switch probe; the chip never shows another provider's numbers.
- **Fail-soft** â€” a probe that errors renders as unknown instead of breaking the composer.
- **Cached per kind** â€” `cacheSeconds` is 60 by default, and 300 for Claude, because every Claude header probe
  spends one token of the plan.
- **Credential-aware** â€” reads named credential records (`credentialRecord`) or env-backed keys (`apiKeyEnv`),
  and can try a list of fallbacks (`apiKeyEnvs`).
- **Used by others** â€” [`dsh-auto-continue`](https://github.com/borncode-app/dsh-auto-continue) reads this
  endpoint to learn when a limit resets.

## Requirements

| | |
|---|---|
| DeepSeek Harness | 0.2.x (Web GUI) |
| Runtime | Node 24, supplied by the Harness runtime |
| Credentials | Whatever the probe needs: `MINIMAX_API_KEY`, `DEEPSEEK_API_KEY`, `ANTHROPIC_OAUTH_TOKEN`, or a signed-in account |

## Install

```bash
git clone https://github.com/borncode-app/dsh-model-quota.git dsh-model-quota
```

Then:

```
plugin_manager install_bundle target=C:\path\to\dsh-model-quota
```

Restart once. The chip appears as soon as the selected model's provider has a working probe.

## Configuration

| field | default | meaning |
|---|---|---|
| `endpoint` | `/plugins/model-quota` | Path the Web GUI (and `dsh-auto-continue`) reads |
| `cacheSeconds` | `60` | Global default cache lifetime |
| `providers` | four built-in probes | Map of provider key â†’ probe settings |

Each provider entry:

| field | meaning |
|---|---|
| `kind` | One of `minimax-coding-plan`, `deepseek-account-balance`, `deepseek-api-balance`, `claude-oauth-usage` |
| `baseURL` | Origin the probe calls |
| `apiKeyEnv` / `apiKeyEnvs` | Env-backed credential(s) to try, in order |
| `credentialRecord` | Named record from the Harness credential store instead of an env var |
| `probeModel` | Model used for a header probe (`claude-oauth-usage` only) |
| `cacheSeconds` | Per-provider override of the global cache |

Removing a provider key turns that chip off entirely â€” for example, drop `anthropic` if you never select a Claude
model and want to stop the periodic header probe.

## How it works

```
selected model â”€â”€â–¶ which provider route? â”€â”€â–¶ matching probe â”€â”€â–¶ cache â”€â”€â–¶ chip
                                                    â”‚
                                     unknown / error â”€â”˜ (renders "â€”", never throws)
```

The probe result is also what `dsh-auto-continue` schedules against, so a wrong `baseURL` shows up both here and
there.

## Files

| file | role |
|---|---|
| `index.js` | probes, cache, endpoint |
| `client.js` | the composer chip |
| `cordis.patch.yml` | the bundle patch with the four provider defaults |
| `locale/{en,th,zh}.json` | UI strings |
| `icon.svg` | plugin icon |

## à¸ à¸²à¸©à¸²à¹„à¸—à¸¢

à¹à¸ªà¸”à¸‡ **à¹‚à¸„à¸§à¸•à¸²/à¸¢à¸­à¸”à¹€à¸‡à¸´à¸™à¸„à¸‡à¹€à¸«à¸¥à¸·à¸­à¸‚à¸­à¸‡à¹‚à¸¡à¹€à¸”à¸¥à¸—à¸µà¹ˆà¹€à¸¥à¸·à¸­à¸à¸­à¸¢à¸¹à¹ˆ** à¹€à¸›à¹‡à¸™à¸›à¹‰à¸²à¸¢à¹ƒà¸•à¹‰à¸Šà¹ˆà¸­à¸‡à¸žà¸´à¸¡à¸žà¹Œ â€” à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¹‚à¸¡à¹€à¸”à¸¥à¸à¹‡à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸•à¸±à¸§à¹€à¸¥à¸‚à¸•à¸²à¸¡ (à¹„à¸¡à¹ˆà¸›à¸™à¸à¸±à¸™)

à¸£à¸­à¸‡à¸£à¸±à¸š 4 à¹à¸šà¸š:

1. **MiniMax coding plan** â€” % à¸„à¸‡à¹€à¸«à¸¥à¸·à¸­à¸‚à¸­à¸‡à¸«à¸™à¹‰à¸²à¸•à¹ˆà¸²à¸‡à¸›à¸±à¸ˆà¸ˆà¸¸à¸šà¸±à¸™ + à¸£à¸²à¸¢à¸ªà¸±à¸›à¸”à¸²à¸«à¹Œ
2. **DeepSeek Platform** â€” à¸¢à¸­à¸”à¹€à¸‡à¸´à¸™à¹ƒà¸™à¸šà¸±à¸à¸Šà¸µ (à¸­à¹ˆà¸²à¸™à¸ˆà¸²à¸ credential à¸—à¸µà¹ˆà¸¥à¹‡à¸­à¸à¸­à¸´à¸™à¹„à¸§à¹‰)
3. **DeepSeek API key** â€” à¸¢à¸­à¸”à¸„à¸‡à¹€à¸«à¸¥à¸·à¸­à¸‚à¸­à¸‡ key à¸™à¸±à¹‰à¸™
4. **Claude Pro/Max** â€” à¸«à¸™à¹‰à¸²à¸•à¹ˆà¸²à¸‡ 5 à¸Šà¸±à¹ˆà¸§à¹‚à¸¡à¸‡ / à¸£à¸²à¸¢à¸ªà¸±à¸›à¸”à¸²à¸«à¹Œ / extra usage

- cache 60 à¸§à¸´à¸™à¸²à¸—à¸µ (Claude 300 à¸§à¸´à¸™à¸²à¸—à¸µ à¹€à¸žà¸£à¸²à¸°à¸à¸²à¸£ probe à¹à¸•à¹ˆà¸¥à¸°à¸„à¸£à¸±à¹‰à¸‡à¸«à¸±à¸ 1 token)
- probe à¸žà¸¥à¸²à¸” â†’ à¸‚à¸¶à¹‰à¸™ "â€”" à¹„à¸¡à¹ˆà¸—à¸³à¹ƒà¸«à¹‰à¸Šà¹ˆà¸­à¸‡à¸žà¸´à¸¡à¸žà¹Œà¸žà¸±à¸‡
- `dsh-auto-continue` à¹ƒà¸Šà¹‰ endpoint à¸™à¸µà¹‰à¹€à¸žà¸·à¹ˆà¸­à¸£à¸¹à¹‰à¸§à¹ˆà¸²à¹‚à¸„à¸§à¸•à¸²à¸ˆà¸°à¸£à¸µà¹€à¸‹à¹‡à¸•à¹€à¸¡à¸·à¹ˆà¸­à¹„à¸£

## License

[MIT](LICENSE) Â© 2026 BornCode
