import z from '@deepseek-ai/schemastery'

/** MiniMax coding-plan quota: per-window and weekly remaining percentages. */
const MINIMAX_QUOTA_PATH = '/v1/api/openplatform/coding_plan/remains'
/** DeepSeek Platform account wallet summary. */
const DEEPSEEK_SUMMARY_PATH = '/api/v0/users/get_user_summary'
/** DeepSeek API-key balance. */
const DEEPSEEK_BALANCE_PATH = '/user/balance'
/** Anthropic subscription usage: the windows a Claude Pro/Max plan meters. */
const CLAUDE_USAGE_PATH = '/api/oauth/usage'

/** Kinds of quota source this plugin knows how to read. */
const KINDS = ['minimax-coding-plan', 'deepseek-account-balance', 'deepseek-api-balance', 'claude-oauth-usage']

export const Config = z.object({
  /** Path the Web GUI polls for the current snapshot. */
  endpoint: z.string().default('/plugins/model-quota'),
  /** Seconds a successful probe is reused. */
  cacheSeconds: z.number().default(60),
  /** Per-request deadline in milliseconds. */
  timeoutMs: z.number().default(10000),
  /** One quota source per provider route id. */
  providers: z.dict(z.object({
    kind: z.union(KINDS),
    baseURL: z.string().required(),
    /** Credential reference holding this route's API key. */
    apiKeyEnv: z.string(),
    /** Further references tried in order when `apiKeyEnv` resolves to nothing. */
    apiKeyEnvs: z.array(z.string()).default([]),
    /** Credential record holding this route's account token. */
    credentialRecord: z.string(),
    /** Model a header probe dispatches; only metre-based sources use it. */
    probeModel: z.string(),
    /** Seconds this source's snapshot stays fresh; defaults to the plugin's cacheSeconds. */
    cacheSeconds: z.number(),
  })).default({}),
})

export const inject = ['llm', 'webServer']

/** Whole seconds as a short "3h 12m" reading. */
function duration(milliseconds) {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds <= 0) return undefined
  const totalMinutes = Math.floor(milliseconds / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`
  return `${String(minutes)}m`
}

/** A finite number, or undefined. */
function numberOf(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Currency amounts as the endpoint reports them: fixed precision strings. */
function money(value) {
  const amount = Number.parseFloat(String(value))
  if (!Number.isFinite(amount)) return String(value)
  return amount.toFixed(2)
}

/** Time from now until an ISO timestamp, as a short reading. */
function until(iso) {
  if (typeof iso !== 'string') return undefined
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return undefined
  return duration(at - Date.now())
}

/**
 * Publish each provider's remaining quota to the Web GUI over one exact route.
 *
 * The model under the composer is the one the session last dispatched a request
 * to, recorded from the `llm/stream` waterfall — the only place a client and the
 * Host agree on without reaching into session-selection internals. Each probe is
 * cached, so a browser poll does not turn into a stream of provider requests.
 */
export function apply(ctx, config) {
  const read = (field, fallback) => {
    const value = config?.[field]
    if (value === undefined) return fallback
    const resolved = typeof value?.get === 'function' ? value.get() : value
    return resolved === undefined ? fallback : resolved
  }

  const logger = ctx.logger
  const timeoutMs = () => read('timeoutMs', 10000)
  const sources = () => read('providers', {}) ?? {}

  /** Last model each session dispatched to, plus a process-wide fallback. */
  const lastBySession = new Map()
  let lastAny

  let cached
  /** Requests answered since this process started, for a quick "is the browser polling?" check. */
  let served = 0
  const remember = (options) => {
    const provider = options?.provider
    const model = options?.model
    if (typeof provider !== 'string' || typeof model !== 'string') return
    const entry = { provider, model }
    lastAny = entry
    const session = options?.sessionId
    if (session !== undefined) lastBySession.set(String(session), entry)
  }

  /** Resolve one credential reference to its secret. */
  const credential = async (name) => {
    if (name === undefined || name.length === 0) return undefined
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return undefined
    const hit = await credentials.resolve(name)
    return hit?.value
  }

  /** Read one credential record's token payload. */
  const recordToken = async (key) => {
    if (key === undefined || key.length === 0) return undefined
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return undefined
    const record = await credentials.readRecord(key)
    const payload = record?.payload
    return typeof payload?.token === 'string' ? payload.token : undefined
  }

  /** The first reference of a source that resolves to a value, with the name that answered. */
  const firstCredential = async (spec) => {
    const names = [spec.apiKeyEnv, ...(spec.apiKeyEnvs ?? [])].filter(name => typeof name === 'string' && name.length > 0)
    for (const name of names) {
      const value = await credential(name)
      if (value !== undefined) return { name, value }
    }
    return { names }
  }

  /** One authenticated GET returning parsed JSON, or a refusal describing why. */
  const getJSON = async (url, headers, what) => {
    let response
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs()),
      })
    } catch (error) {
      return { failure: `${what}: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (!response.ok) {
      await response.body?.cancel()
      return { failure: `${what}: HTTP ${String(response.status)}` }
    }
    try {
      return { body: await response.json() }
    } catch {
      return { failure: `${what}: the reply was not JSON` }
    }
  }

  /** MiniMax coding plan: window and weekly remaining percentages. */
  const minimaxQuota = async (spec) => {
    const key = await credential(spec.apiKeyEnv)
    if (key === undefined) return { ok: false, reason: 'missing-credential', credential: spec.apiKeyEnv }
    const answer = await getJSON(
      `${spec.baseURL.replace(/\/+$/u, '')}${MINIMAX_QUOTA_PATH}`,
      { authorization: `Bearer ${key}` },
      'MiniMax quota',
    )
    if (answer.failure !== undefined) return { ok: false, reason: 'request-failed', message: answer.failure }
    const rows = Array.isArray(answer.body?.model_remains) ? answer.body.model_remains : []
    const row = rows.find(entry => entry?.model_name === 'general') ?? rows[0]
    if (row === undefined) return { ok: false, reason: 'no-quota-row' }
    const window = numberOf(row.current_interval_remaining_percent)
    const weekly = numberOf(row.current_weekly_remaining_percent)
    const details = []
    if (window !== undefined) details.push({ key: 'window', value: `${String(window)}%` })
    if (weekly !== undefined) details.push({ key: 'weekly', value: `${String(weekly)}%` })
    const resetIn = duration(numberOf(row.remains_time))
    if (resetIn !== undefined) details.push({ key: 'resetIn', value: resetIn })
    const weeklyResetIn = duration(numberOf(row.weekly_remains_time))
    if (weeklyResetIn !== undefined) details.push({ key: 'weeklyResetIn', value: weeklyResetIn })
    return {
      ok: true,
      kind: spec.kind,
      percent: window ?? weekly,
      weeklyPercent: weekly,
      // Machine-readable window reset, for consumers that schedule work after it.
      resetInMs: numberOf(row.remains_time),
      details,
    }
  }

  /** DeepSeek Platform account: wallet balances across currencies. */
  const deepseekAccountBalance = async (spec) => {
    const token = await recordToken(spec.credentialRecord)
    if (token === undefined) return { ok: false, reason: 'missing-credential', credential: spec.credentialRecord }
    const answer = await getJSON(
      `${spec.baseURL.replace(/\/+$/u, '')}${DEEPSEEK_SUMMARY_PATH}`,
      { 'x-dsh-auth-token': token },
      'DeepSeek account',
    )
    if (answer.failure !== undefined) return { ok: false, reason: 'request-failed', message: answer.failure }
    const summary = answer.body?.data?.biz_data ?? {}
    const wallets = Array.isArray(summary.normal_wallets) ? summary.normal_wallets : []
    const bonus = Array.isArray(summary.bonus_wallets) ? summary.bonus_wallets : []
    const bonusOf = (currency) => bonus.find(wallet => wallet?.currency === currency)?.balance
    const details = []
    for (const wallet of wallets) {
      const currency = String(wallet?.currency ?? '')
      details.push({ key: 'balance', value: `${currency} ${money(wallet?.balance ?? '0')}` })
      const granted = bonusOf(currency)
      if (granted !== undefined) details.push({ key: 'bonus', value: `${currency} ${money(granted)}` })
    }
    // A grant-only currency has no pay-as-you-go wallet, but it is still credit the account can spend.
    for (const wallet of bonus) {
      const currency = String(wallet?.currency ?? '')
      if (wallets.some(entry => entry?.currency === wallet?.currency)) continue
      details.push({ key: 'bonus', value: `${currency} ${money(wallet?.balance ?? '0')}` })
    }
    if (details.length === 0) return { ok: false, reason: 'no-wallet' }
    return { ok: true, kind: spec.kind, details, primary: details[0] }
  }

  /** DeepSeek API key: granted and topped-up balances. */
  const deepseekApiBalance = async (spec) => {
    const key = await credential(spec.apiKeyEnv)
    if (key === undefined) return { ok: false, reason: 'missing-credential', credential: spec.apiKeyEnv }
    const answer = await getJSON(
      `${spec.baseURL.replace(/\/+$/u, '')}${DEEPSEEK_BALANCE_PATH}`,
      { authorization: `Bearer ${key}` },
      'DeepSeek balance',
    )
    if (answer.failure !== undefined) return { ok: false, reason: 'request-failed', message: answer.failure }
    const infos = Array.isArray(answer.body?.balance_infos) ? answer.body.balance_infos : []
    if (infos.length === 0) return { ok: false, reason: 'no-wallet' }
    const details = infos.map(info => ({
      key: 'balance',
      value: `${String(info?.currency ?? '')} ${money(info?.total_balance ?? '0')}`,
    }))
    return { ok: true, kind: spec.kind, details, primary: details[0], available: answer.body?.is_available === true }
  }

  /** Normalize one utilization reading: the metered windows report either a fraction or a percentage. */
  const utilizationPercent = (value) => {
    const used = numberOf(value)
    if (used === undefined) return undefined
    return Math.max(0, Math.min(100, Math.round(used <= 1 ? used * 100 : used)))
  }

  /** Render the remaining-share readings shared by both Claude probes. */
  const claudeSnapshot = (spec, fiveHour, weekly, extra) => {
    const details = []
    if (fiveHour !== undefined) {
      details.push({ key: 'window', value: `${String(fiveHour.remaining)}%` })
      if (fiveHour.resetAt !== undefined) details.push({ key: 'resetIn', value: fiveHour.resetAt })
    }
    if (weekly !== undefined) details.push({ key: 'weekly', value: `${String(weekly.remaining)}%` })
    if (weekly?.resetAt !== undefined) details.push({ key: 'weeklyResetIn', value: weekly.resetAt })
    if (extra !== undefined) details.push({ key: 'extra', value: `${String(extra)}%` })
    if (details.length === 0) return { ok: false, reason: 'no-quota-buckets' }
    return {
      ok: true,
      kind: spec.kind,
      percent: fiveHour?.remaining ?? weekly?.remaining,
      weeklyPercent: weekly?.remaining,
      // Machine-readable window reset, for consumers that schedule work after it.
      resetInMs: fiveHour?.resetInMs ?? weekly?.resetInMs,
      details,
    }
  }

  /**
   * Read the plan's usage windows from the OAuth usage endpoint.
   *
   * Only a token that carries the `user:profile` scope may call it. A Claude
   * Code setup token is inference-only, so the endpoint refuses it and the
   * caller falls back to the rate-limit headers of a one-token message.
   */
  const claudeUsageEndpoint = async (spec, token) => {
    const answer = await getJSON(
      `${spec.baseURL.replace(/\/+$/u, '')}${CLAUDE_USAGE_PATH}`,
      { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      'Claude usage',
    )
    if (answer.failure !== undefined) return { failure: answer.failure }
    const bucket = (value) => {
      if (value === null || typeof value !== 'object') return undefined
      const used = utilizationPercent(value.utilization)
      if (used === undefined) return undefined
      const resetsAt = typeof value.resets_at === 'string' ? Date.parse(value.resets_at) : Number.NaN
      return {
        remaining: Math.max(0, 100 - used),
        resetAt: Number.isFinite(resetsAt) ? until(value.resets_at) : undefined,
        resetInMs: Number.isFinite(resetsAt) ? resetsAt - Date.now() : undefined,
      }
    }
    const extra = answer.body?.extra_usage
    const extraUsed = utilizationPercent(extra?.utilization)
    const snapshot = claudeSnapshot(
      spec,
      bucket(answer.body?.five_hour),
      bucket(answer.body?.seven_day),
      extra?.is_enabled === true && extraUsed !== undefined ? 100 - extraUsed : undefined,
    )
    // A scope refusal or an empty body means this token cannot answer here.
    if (snapshot.ok === true) return { snapshot }
    return { failure: 'the usage endpoint returned no plan window' }
  }

  /**
   * Read the plan's windows from the unified rate-limit headers of one message.
   *
   * Anthropic reports `anthropic-ratelimit-unified-5h-*` / `-7d-*` on every
   * Messages reply for a subscription token, so a one-token request is the
   * cheapest authoritative reading when the usage endpoint is out of reach.
   */
  const claudeInferenceHeaders = async (spec, token) => {
    const base = spec.baseURL.replace(/\/+$/u, '')
    const model = typeof spec.probeModel === 'string' && spec.probeModel.length > 0 ? spec.probeModel : 'claude-haiku-4-5'
    let response
    try {
      response = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        signal: AbortSignal.timeout(timeoutMs()),
      })
    } catch (error) {
      return { failure: `Claude rate-limit headers: ${error instanceof Error ? error.message : String(error)}` }
    }
    const header = (name) => response.headers.get(name) ?? undefined
    if (!response.ok) {
      await response.body?.cancel()
      const limited = response.status === 429
      return { failure: `Claude rate-limit headers: HTTP ${String(response.status)}`, limited }
    }
    await response.body?.cancel()
    const reading = (prefix) => {
      const used = utilizationPercent(Number.parseFloat(header(`anthropic-ratelimit-unified-${prefix}-utilization`) ?? ''))
      const reset = Number.parseFloat(header(`anthropic-ratelimit-unified-${prefix}-reset`) ?? '')
      if (used === undefined) return undefined
      const resetsAt = Number.isFinite(reset) && reset > 0 ? reset * 1000 : Number.NaN
      return {
        remaining: Math.max(0, 100 - used),
        resetAt: Number.isFinite(resetsAt) ? duration(resetsAt - Date.now()) : undefined,
        resetInMs: Number.isFinite(resetsAt) ? resetsAt - Date.now() : undefined,
      }
    }
    const snapshot = claudeSnapshot(spec, reading('5h'), reading('7d'), undefined)
    if (snapshot.ok === true) return { snapshot }
    return { failure: 'the reply carried no unified rate-limit window' }
  }

  /**
   * Claude Pro/Max subscription: the metered windows the plan reports.
   *
   * An ordinary `sk-ant-api03-…` API key can never answer either probe, so that
   * case reports `needs-subscription-token` instead of pretending the account
   * is out of quota.
   */
  const claudeUsage = async (spec) => {
    const found = await firstCredential(spec)
    if (found.value === undefined) return { ok: false, reason: 'missing-credential', credential: found.names.join(', ') }
    if (!found.value.startsWith('sk-ant-oat')) {
      return { ok: false, reason: 'needs-subscription-token', credential: found.name }
    }
    const direct = await claudeUsageEndpoint(spec, found.value)
    if (direct.snapshot !== undefined) return direct.snapshot
    const headers = await claudeInferenceHeaders(spec, found.value)
    if (headers.snapshot !== undefined) return headers.snapshot
    return {
      ok: false,
      reason: headers.limited === true ? 'rate-limited' : 'request-failed',
      message: headers.failure,
    }
  }

  /** Probe one provider, reusing a fresh snapshot. */
  const probe = async (selected) => {
    const key = `${selected.provider}\u0000${selected.model}`
    const now = Date.now()
    const spec = sources()[selected.provider]
    const ttlSeconds = numberOf(spec?.cacheSeconds) ?? read('cacheSeconds', 60)
    if (cached !== undefined && cached.key === key && now - cached.at < Math.max(0, ttlSeconds) * 1000) return cached.value

    let value
    if (spec === undefined) {
      value = { ok: false, reason: 'unsupported-provider' }
    } else {
      try {
        if (spec.kind === 'minimax-coding-plan') value = await minimaxQuota(spec)
        else if (spec.kind === 'deepseek-account-balance') value = await deepseekAccountBalance(spec)
        else if (spec.kind === 'deepseek-api-balance') value = await deepseekApiBalance(spec)
        else if (spec.kind === 'claude-oauth-usage') value = await claudeUsage(spec)
        else value = { ok: false, reason: 'unsupported-kind' }
      } catch (error) {
        value = { ok: false, reason: 'probe-failed', message: error instanceof Error ? error.message : String(error) }
      }
    }
    const snapshot = { provider: selected.provider, model: selected.model, at: new Date(now).toISOString(), ...value }
    cached = { key, at: now, value: snapshot }
    if (snapshot.ok !== true) logger.warn(`model-quota: ${selected.provider}: ${String(snapshot.reason)}${snapshot.message === undefined ? '' : ` (${snapshot.message})`}`)
    return snapshot
  }

  /** Answer one browser poll with the current snapshot. */
  const answer = async (res, selected, source) => {
    let snapshot
    if (selected === undefined) snapshot = { ok: false, reason: 'no-model-yet' }
    else snapshot = await probe(selected)
    served += 1
    const body = JSON.stringify({ ...snapshot, served, source, recorded: lastBySession.size })
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  }

  ctx.effect(() => {
    const endpoint = read('endpoint', '/plugins/model-quota')
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: endpoint,
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405)
          res.end()
          return
        }
        let session
        let explicit
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          session = url.searchParams.get('session') ?? undefined
          const provider = url.searchParams.get('provider')
          const model = url.searchParams.get('model')
          if (provider !== null && provider.length > 0) explicit = { provider, model: model ?? '' }
        } catch {
          session = undefined
        }
        const recorded = session === undefined ? undefined : lastBySession.get(session)
        // A named session answers for its own model only: another session's
        // provider would show a quota this conversation cannot spend.
        const selected = explicit ?? (session === undefined ? lastAny : recorded)
        const source = explicit !== undefined ? 'explicit' : recorded !== undefined ? 'session' : session === undefined ? 'any' : 'none'
        if (req.url !== undefined && req.url.includes('providers=1')) {
          const reply = async () => {
            const providers = ctx.llm.listProviders()
            const models = {}
            for (const info of providers) {
              try {
                models[info.id] = (await ctx.llm.listModels(info.id)).map(model => model.id)
              } catch {
                models[info.id] = []
              }
            }
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({ providers, models }))
          }
          void reply().catch(() => {
            res.writeHead(500)
            res.end()
          })
          return
        }
        void answer(res, selected, source).catch(error => {
          logger.warn(`model-quota: ${error instanceof Error ? error.message : String(error)}`)
          res.writeHead(500)
          res.end()
        })
      },
    })
    return dispose
  }, 'model-quota: quota route')

  ctx.on('llm/stream', (options, next) => {
    try {
      remember(options)
    } catch {
      /* recording is best effort; a failed record must never fail a model call */
    }
    return next()
  })
}
