window.__ModuleLoader__.load({
  id: '@local/dsh-model-quota',
  factory: (require) => {
    const React = require('react')
    const NS = '@local/dsh-model-quota'
    /** Must match the Host row's `endpoint`. */
    const ENDPOINT = '/plugins/model-quota'
    /** How often the browser re-reads the cached snapshot. */
    const POLL_MS = 60000

    /** Visible text. Kept beside the exported locale resources for the same keys. */
    const dictionaries = {
      en: {
        'quota.title': 'Rate limit',
        'quota.window': '{percent}% left',
        'quota.weekly': 'wk {percent}%',
        'quota.windowLabel': '5-hour window',
        'quota.weeklyLabel': 'Weekly',
        'quota.weeklySonnetLabel': 'Weekly (Sonnet)',
        'quota.resetIn': 'Resets in',
        'quota.weeklyResetIn': 'Week resets in',
        'quota.extra': 'Extra usage',
        'quota.balance': 'Balance',
        'quota.bonus': 'Bonus credit',
      },
      th: {
        'quota.title': 'โควตาคงเหลือ',
        'quota.window': 'เหลือ {percent}%',
        'quota.weekly': 'สัปดาห์ {percent}%',
        'quota.windowLabel': 'หน้าต่าง 5 ชั่วโมง',
        'quota.weeklyLabel': 'รายสัปดาห์',
        'quota.weeklySonnetLabel': 'รายสัปดาห์ (Sonnet)',
        'quota.resetIn': 'รีเซ็ตใน',
        'quota.weeklyResetIn': 'สัปดาห์รีเซ็ตใน',
        'quota.extra': 'การใช้งานเพิ่มเติม',
        'quota.balance': 'ยอดคงเหลือ',
        'quota.bonus': 'เครดิตโบนัส',
      },
      zh: {
        'quota.title': '剩余额度',
        'quota.window': '剩余 {percent}%',
        'quota.weekly': '每周 {percent}%',
        'quota.windowLabel': '5 小时窗口',
        'quota.weeklyLabel': '每周',
        'quota.weeklySonnetLabel': '每周（Sonnet）',
        'quota.resetIn': '重置',
        'quota.weeklyResetIn': '每周重置',
        'quota.extra': '额外用量',
        'quota.balance': '余额',
        'quota.bonus': '赠送额度',
      },
    }

    /** Detail keys the Host reports, and the label each one reads. */
    const DETAIL_LABELS = {
      window: 'windowLabel',
      weekly: 'weeklyLabel',
      weeklySonnet: 'weeklySonnetLabel',
      resetIn: 'resetIn',
      weeklyResetIn: 'weeklyResetIn',
      extra: 'extra',
      balance: 'balance',
      bonus: 'bonus',
    }

    /** Fill `{name}` placeholders from one values object. */
    function format(text, values) {
      if (values === undefined) return text
      return text.replace(/\{(\w+)\}/gu, (match, name) => (values[name] === undefined ? match : String(values[name])))
    }

    const styles = {
      anchor: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        height: '20px',
        padding: '0 2px',
        color: 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '20px',
        whiteSpace: 'nowrap',
        border: 'none',
        background: 'none',
      },
      label: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
      },
      separator: {
        opacity: 0.5,
        padding: '0 1px',
      },
    }

    /** A small gauge glyph whose ring shows how much of the quota remains. */
    function GaugeIcon({ percent }) {
      const remains = typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : 100
      return React.createElement(
        'svg',
        { width: 13, height: 13, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
        React.createElement('circle', {
          cx: 12, cy: 12, r: 9,
          fill: 'none', stroke: 'currentColor', strokeOpacity: 0.3, strokeWidth: 2.5,
        }),
        React.createElement('circle', {
          cx: 12, cy: 12, r: 9,
          fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round',
          strokeDasharray: `${String((remains / 100) * 56.55)} 56.55`,
          transform: 'rotate(-90 12 12)',
        }),
      )
    }

    /** The reading color for a remaining percentage. */
    function toneColor(percent) {
      if (typeof percent !== 'number') return 'var(--dsw-alias-label-secondary)'
      if (percent <= 10) return 'var(--dsw-alias-state-error-primary)'
      if (percent <= 25) return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-label-secondary)'
    }

    const apply = (ctx) => {
      /** Translate through this plugin's own dictionaries, following the locale service. */
      const t = (key, values) => {
        let id = 'en'
        try {
          const snapshot = ctx.locale.getSnapshot()
          id = String(snapshot?.id ?? 'en')
        } catch {
          id = 'en'
        }
        const dict = dictionaries[id] ?? dictionaries[id.split('-')[0]] ?? dictionaries.en
        return format(dict[key] ?? dictionaries.en[key] ?? key, values)
      }

      /** The quota reading for this session, or nothing while none applies. */
      function QuotaPill(props) {
        const sessionId = props.sessionId
        const [snapshot, setSnapshot] = React.useState(undefined)

        React.useEffect(() => {
          if (sessionId === undefined) return undefined
          let cancelled = false
          let timer
          const load = async () => {
            try {
              const response = await fetch(`${ENDPOINT}?session=${encodeURIComponent(String(sessionId))}`, {
                headers: { accept: 'application/json' },
              })
              const body = await response.json()
              if (!cancelled) setSnapshot(body)
            } catch {
              /* a transient failure keeps the previous reading */
            }
            if (!cancelled) timer = setTimeout(() => void load(), POLL_MS)
          }
          void load()
          return () => {
            cancelled = true
            clearTimeout(timer)
          }
        }, [sessionId])

        if (snapshot === undefined || snapshot.ok !== true) return null

        const details = Array.isArray(snapshot.details) ? snapshot.details : []
        const tooltip = details
          .map(detail => `${t(`quota.${DETAIL_LABELS[detail.key] ?? detail.key}`)}: ${detail.value}`)
          .join('\n')

        let primary
        let secondary
        if (typeof snapshot.percent === 'number') {
          primary = t('quota.window', { percent: snapshot.percent })
          if (typeof snapshot.weeklyPercent === 'number') secondary = t('quota.weekly', { percent: snapshot.weeklyPercent })
        } else if (snapshot.primary !== undefined) {
          primary = String(snapshot.primary.value)
        }
        if (primary === undefined) return null

        return React.createElement(
          'span',
          {
            style: { ...styles.anchor, color: toneColor(snapshot.percent) },
            'data-composer-stat': 'quota',
            title: tooltip.length === 0 ? t('quota.title') : `${t('quota.title')}\n${tooltip}`,
          },
          React.createElement(GaugeIcon, { percent: snapshot.percent }),
          React.createElement(
            'span',
            { style: styles.label },
            React.createElement('span', null, primary),
            secondary === undefined
              ? null
              : React.createElement('span', { style: styles.separator, 'aria-hidden': 'true' }, '·'),
            secondary === undefined ? null : React.createElement('span', null, secondary),
          ),
        )
      }

      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register({ name: 'conversation.composer.dock', id: 'quota', order: 2 }, QuotaPill),
      )
      void NS
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
