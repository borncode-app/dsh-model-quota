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

## What it does

Every provider hides its remaining quota somewhere different — a coding-plan window, an account wallet, a
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

- **Follows the model** — switch model, switch probe; the chip never shows another provider's numbers.
- **Fail-soft** — a probe that errors renders as unknown instead of breaking the composer.
- **Cached per kind** — `cacheSeconds` is 60 by default, and 300 for Claude, because every Claude header probe
  spends one token of the plan.
- **Credential-aware** — reads named credential records (`credentialRecord`) or env-backed keys (`apiKeyEnv`),
  and can try a list of fallbacks (`apiKeyEnvs`).
- **Used by others** — [`dsh-auto-continue`](https://github.com/borncode-app/dsh-auto-continue) reads this
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
| `providers` | four built-in probes | Map of provider key → probe settings |

Each provider entry:

| field | meaning |
|---|---|
| `kind` | One of `minimax-coding-plan`, `deepseek-account-balance`, `deepseek-api-balance`, `claude-oauth-usage` |
| `baseURL` | Origin the probe calls |
| `apiKeyEnv` / `apiKeyEnvs` | Env-backed credential(s) to try, in order |
| `credentialRecord` | Named record from the Harness credential store instead of an env var |
| `probeModel` | Model used for a header probe (`claude-oauth-usage` only) |
| `cacheSeconds` | Per-provider override of the global cache |

Removing a provider key turns that chip off entirely — for example, drop `anthropic` if you never select a Claude
model and want to stop the periodic header probe.

## How it works

```
selected model ──▶ which provider route? ──▶ matching probe ──▶ cache ──▶ chip
                                                    │
                                     unknown / error ─┘ (renders "—", never throws)
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

## ภาษาไทย

แสดง **โควตา/ยอดเงินคงเหลือของโมเดลที่เลือกอยู่** เป็นป้ายใต้ช่องพิมพ์ — เปลี่ยนโมเดลก็เปลี่ยนตัวเลขตาม (ไม่ปนกัน)

รองรับ 4 แบบ:

1. **MiniMax coding plan** — % คงเหลือของหน้าต่างปัจจุบัน + รายสัปดาห์
2. **DeepSeek Platform** — ยอดเงินในบัญชี (อ่านจาก credential ที่ล็อกอินไว้)
3. **DeepSeek API key** — ยอดคงเหลือของ key นั้น
4. **Claude Pro/Max** — หน้าต่าง 5 ชั่วโมง / รายสัปดาห์ / extra usage

- cache 60 วินาที (Claude 300 วินาที เพราะการ probe แต่ละครั้งหัก 1 token)
- probe พลาด → ขึ้น "—" ไม่ทำให้ช่องพิมพ์พัง
- `dsh-auto-continue` ใช้ endpoint นี้เพื่อรู้ว่าโควตาจะรีเซ็ตเมื่อไร

## License

[MIT](LICENSE) © 2026 BornCode
