/**
 * dsh-whalechan-herself —— 浏览器半端（设置里的一页）
 * ============================================================================
 * client bundle 不是 ESM，是自注册脚本（约定与 dsh-bili-scroll 一致）：
 *
 *     window.__ModuleLoader__.load({
 *       id: '<包名>',                       // 必须等于 package.json 的 name
 *       factory: (require) => ({ inject: [...], apply(ctx) {...} }),
 *     })
 *
 * 进「设置」：slot 名 `settings.section`，`label` 就是左侧导航那一项。
 * 面板只做一件事——读数、改数、存数；掷骰本身在宿主侧（lib/index.js 的
 * agent/pre-step），所以这里不需要知道当前会话。
 *
 * 页面不轮询，输入框还是先放本地草稿再显式保存：轮询 + 直接绑服务端值会把
 * 用户正在拖的滑条冲回去（dsh-bili-scroll 踩过）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-whalechan-herself',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/plugins/dsh-whalechan-herself/config.json'

    const row = { display: 'flex', alignItems: 'center', gap: 12, margin: '10px 0' }
    const button = {
      padding: '6px 16px',
      borderRadius: 6,
      border: '1px solid currentColor',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      cursor: 'pointer',
    }
    const area = {
      width: '100%',
      padding: '8px 10px',
      borderRadius: 6,
      border: '1px solid currentColor',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      lineHeight: 1.6,
      resize: 'vertical',
      boxSizing: 'border-box',
    }
    const number = {
      width: 76,
      padding: '4px 8px',
      borderRadius: 6,
      border: '1px solid currentColor',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
    }

    async function call(method, body) {
      const res = await fetch(API, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      // 必须查 res.ok：服务端 500 时 body 也可能是 {ok:false}，不查就会把失败当保存成功。
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    }

    /** 自定义设定的长度上限，和 lib/chance.js 的 MAX_CUSTOM 对齐（超了服务端会截）。 */
    const MAX_CUSTOM = 2000

    function Panel() {
      const [draft, setDraft] = React.useState(null)
      const [note, setNote] = React.useState('读取中…')
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        call('GET')
          .then((data) => {
            if (!alive) return
            setDraft({ chance: data.chance, custom: data.custom ?? '' })
            setNote(null)
          })
          .catch((error) => {
            if (alive) setNote(`读取失败：${error.message}`)
          })
        return () => {
          alive = false
        }
      }, [])

      const value = draft === null ? 0 : draft.chance
      const custom = draft === null ? '' : draft.custom
      const disabled = busy || draft === null
      const patch = (next) => setDraft({ chance: value, custom, ...next })

      const save = async () => {
        setBusy(true)
        setNote(null)
        try {
          const data = await call('POST', { chance: value, custom })
          setDraft({ chance: data.chance, custom: data.custom ?? '' })
          setNote('已保存')
        } catch (error) {
          setNote(`保存失败：${error.message}`)
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { style: { padding: '4px 2px', maxWidth: 560 } },
        h('div', { style: { fontSize: 16, fontWeight: 600, marginBottom: 6 } }, '表情包概率'),
        h(
          'div',
          { style: { fontSize: 13, opacity: 0.7, lineHeight: 1.7, marginBottom: 16 } },
          '每轮对话开始时掷一次骰：命中就这一轮发一张表情包，未命中就不发。0 = 关闭，100 = 每轮都发。',
        ),
        h(
          'div',
          { style: row },
          h('input', {
            type: 'range',
            min: 0,
            max: 100,
            step: 0.1,
            value,
            disabled,
            onChange: (event) => patch({ chance: Math.round(Number(event.target.value) * 10) / 10 }),
            style: { flex: 1 },
          }),
          h('input', {
            type: 'number',
            min: 0,
            max: 100,
            step: 0.1,
            value,
            disabled,
            onChange: (event) => {
              const next = Number(event.target.value)
              patch({ chance: Number.isFinite(next) ? Math.max(0, Math.min(100, Math.round(next * 10) / 10)) : 0 })
            },
            style: number,
          }),
          h('span', { style: { fontSize: 13, opacity: 0.7 } }, '%'),
        ),
        h('div', { style: { fontSize: 16, fontWeight: 600, margin: '28px 0 6px' } }, '自定义设定'),
        h(
          'div',
          { style: { fontSize: 13, opacity: 0.7, lineHeight: 1.7, marginBottom: 10 } },
          '写在这里的话会追加进她的系统提示（跟在角色设定后面）。可以定名字、怎么称呼你、口癖、额外规矩；留空就清掉。改完对新一轮直接生效。',
        ),
        h('textarea', {
          value: custom,
          disabled,
          maxLength: MAX_CUSTOM,
          rows: 7,
          placeholder: '例：\n你叫阿鲸，喊我老板。\n别叫我助手，也别自称 AI。\n汇报时先给结论，再给细节。',
          onChange: (event) => patch({ custom: event.target.value }),
          style: area,
        }),
        h(
          'div',
          { style: { fontSize: 12, opacity: 0.55, margin: '6px 0 0', textAlign: 'right' } },
          `${String(custom.length)} / ${String(MAX_CUSTOM)}`,
        ),
        h(
          'div',
          { style: { ...row, marginTop: 18 } },
          h(
            'button',
            {
              type: 'button',
              onClick: save,
              disabled,
              style: { ...button, opacity: disabled ? 0.5 : 1 },
            },
            busy ? '保存中…' : '保存',
          ),
          note === null ? null : h('span', { style: { fontSize: 12, opacity: 0.75 } }, note),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () =>
          slots.register({ name: 'settings.section', id: 'whalechan', order: 25, label: '鲸鱼娘' }, () => h(Panel)),
        )
      },
    }
  },
})
