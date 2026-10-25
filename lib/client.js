/**
 * dsh-whalechan-herself —— 浏览器半端
 * ============================================================================
 * client bundle 不是 ESM，是自注册脚本（约定与 dsh-bili-scroll 一致）：
 *
 *     window.__ModuleLoader__.load({
 *       id: '<包名>',                       // 必须等于 package.json 的 name
 *       factory: (require) => ({ inject: [...], apply(ctx) {...} }),
 *     })
 *
 * 两个页面：
 *   设置 → slot `settings.section`：表情包概率 / 自定义设定 / 日记位置
 *   侧边栏 → 🐟️の日记：装了 dsh-better-sidebar 走 registerTab，否则退回
 *   原生右侧栏 tab（sidebarRightTabs + sidebar.right.pane.tab），两个 id
 *   带作者后缀互不相撞（dsh-git 的教训）。
 *
 * 页面不轮询，输入框先放本地草稿再显式保存：轮询 + 直接绑服务端值会把
 * 用户正在编辑的条目冲回去。活动流用低频轮询（8s），只在页面可见时跑。
 */
window.__ModuleLoader__.load({
  id: 'dsh-whalechan-herself',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const CONFIG_API = '/plugins/dsh-whalechan-herself/config.json'
    const DIARY_API = '/plugins/dsh-whalechan-herself/diary.json'

    const TAB_ID = 'whalechan-diary-by-weidows'
    const NATIVE_KIND = 'whalechan-diary-native-by-weidows'
    const STYLE_ID = 'whalechan-diary-style'

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
    const input = { ...area, resize: 'none' }

    async function api(path, method, body) {
      const res = await fetch(path, {
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

    // ---------------------------------------------------------------- 设置页 --

    function SettingsPanel() {
      const [draft, setDraft] = React.useState(null)
      const [note, setNote] = React.useState('读取中…')
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        api(CONFIG_API, 'GET')
          .then((data) => {
            if (!alive) return
            setDraft({ chance: data.chance, custom: data.custom ?? '', memHome: data.memHome ?? '' })
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
      const memHome = draft === null ? '' : draft.memHome
      const disabled = busy || draft === null
      const patch = (next) => setDraft({ chance: value, custom, memHome, ...next })

      const save = async () => {
        setBusy(true)
        setNote(null)
        try {
          const data = await api(CONFIG_API, 'POST', { chance: value, custom, memHome })
          setDraft({ chance: data.chance, custom: data.custom ?? '', memHome: data.memHome ?? '' })
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
            style: { width: 76, padding: '4px 8px', borderRadius: 6, border: '1px solid currentColor', background: 'transparent', color: 'inherit', font: 'inherit' },
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
        h('div', { style: { fontSize: 16, fontWeight: 600, margin: '28px 0 6px' } }, '🐟️の日记 位置'),
        h(
          'div',
          { style: { fontSize: 13, opacity: 0.7, lineHeight: 1.7, marginBottom: 10 } },
          '日记和主人的档案存在这个目录（跨会话、跨项目共享）。支持 ~ 开头；留空用默认 ~/.mem/whalechan。改完对新会话生效。',
        ),
        h('input', {
          value: memHome,
          disabled,
          placeholder: '~/.mem/whalechan',
          onChange: (event) => patch({ memHome: event.target.value }),
          style: input,
        }),
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

    // ------------------------------------------------------------ 日记页面 --

    const whaleIcon = (size = 16) =>
      h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { flex: 'none', display: 'block' } },
        h('path', {
          d: 'M2 8.5c0-3 2.4-5.3 5.6-5.3 3.1 0 5.4 2 5.4 4.7 0 2.4-1.9 4-4.4 4-1.2 0-1.9-.3-2.6-.8L4 12.3l.5-1.6C3.5 10 2 9.5 2 8.5Z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
        h('circle', { cx: 6.2, cy: 7.6, r: 0.8, fill: 'currentColor' }),
        h('path', { d: 'M9.6 6.4c.6.5 1.5.5 2.1 0M9.8 9c.5.4 1.3.4 1.8 0', stroke: 'currentColor', strokeWidth: 0.9, strokeLinecap: 'round' }),
      )

    const TARGET_META = {
      diary: { title: '🐟️の日记', hint: '鲸鱼娘的记事本：常用工具、目录嵌套、图的存放规则、命名格式、服务器连接习惯、禁止的点、alias 叫法、教训。' },
      master: { title: '主人的档案', hint: '主人的稳定偏好：称呼、作息、禁忌（比如禁止打满 CPU/GPU）、喜欢的工作方式。' },
    }

    /** 侧边栏正文。visible=false 时（better-sidebar 挂载但不显示）停掉轮询。 */
    function DiaryPanel(props) {
      const visible = props?.visible !== false
      const [tab, setTab] = React.useState('diary')
      const [data, setData] = React.useState(null)
      const [drafts, setDrafts] = React.useState(null) // { diary: [...], master: [...] } 本地编辑态
      const [note, setNote] = React.useState('读取中…')
      const [busy, setBusy] = React.useState(false)
      const [activity, setActivity] = React.useState([])

      const load = React.useCallback(() => {
        return api(DIARY_API, 'GET')
          .then((next) => {
            setData(next)
            setDrafts((prev) => prev ?? { diary: next.diary.entries, master: next.master.entries })
            setNote(null)
          })
          .catch((error) => setNote(`读取失败：${error.message}`))
      }, [])

      React.useEffect(() => {
        if (!visible) return
        load()
      }, [visible, load])

      // 活动流低频轮询：页面可见才跑，8s 足够「直观」，不至于刷请求。
      React.useEffect(() => {
        if (!visible) return
        const fetchActivity = () => {
          const memHome = data?.memHome
          if (!memHome) return
          api(`${DIARY_API}?view=activity`, 'GET')
            .then((payload) => setActivity(payload.activity ?? []))
            .catch(() => {})
        }
        fetchActivity()
        const timer = setInterval(fetchActivity, 8000)
        return () => clearInterval(timer)
      }, [visible, data?.memHome])

      const entries = drafts === null ? [] : drafts[tab]
      const usage = data === null ? null : data[tab].usage
      const meta = TARGET_META[tab]

      const editEntry = (index, value) => {
        setDrafts({ ...drafts, [tab]: drafts[tab].map((e, i) => (i === index ? value : e)) })
      }
      const removeEntry = (index) => {
        setDrafts({ ...drafts, [tab]: drafts[tab].filter((_, i) => i !== index) })
      }
      const addEntry = () => {
        setDrafts({ ...drafts, [tab]: [...drafts[tab], ''] })
      }

      const save = async () => {
        setBusy(true)
        setNote(null)
        try {
          await api(DIARY_API, 'POST', { target: tab, entries })
          await load()
          setDrafts({ diary: (tab === 'diary' ? entries : data.diary.entries), master: (tab === 'master' ? entries : data.master.entries) })
          setNote('已保存')
        } catch (error) {
          setNote(`保存失败：${error.message}`)
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, font: 'inherit' } },
        // 两个库的切换 + 用量
        h(
          'div',
          { style: { display: 'flex', gap: 6, padding: '10px 12px 0' } },
          ...Object.entries(TARGET_META).map(([key, m]) =>
            h(
              'button',
              {
                key,
                type: 'button',
                onClick: () => setTab(key),
                style: {
                  ...button,
                  padding: '4px 10px',
                  opacity: tab === key ? 1 : 0.55,
                  fontWeight: tab === key ? 600 : 400,
                },
              },
              `${m.title}${data === null ? '' : ` ${String(data[key].usage.count)}`}`,
            ),
          ),
        ),
        h(
          'div',
          { style: { padding: '6px 12px 0', fontSize: 12, opacity: 0.7 } },
          usage === null
            ? '…'
            : `${String(usage.count)} 条 · ${String(usage.chars)}/${String(usage.limit)} 字 · ${String(usage.pct)}%${data.memHome ? `　@ ${data.memHome}` : ''}`,
        ),
        h(
          'div',
          { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { style: { fontSize: 12, opacity: 0.6, lineHeight: 1.6 } }, meta.hint),
          ...entries.map((entry, index) =>
            h(
              'div',
              { key: String(index), style: { display: 'flex', gap: 6, alignItems: 'flex-start' } },
              h('textarea', {
                value: entry,
                rows: Math.max(2, Math.min(8, Math.ceil((entry.length + 1) / 34))),
                onChange: (event) => editEntry(index, event.target.value),
                style: { ...area, flex: 1, padding: '6px 8px', fontSize: 13 },
              }),
              h(
                'button',
                {
                  type: 'button',
                  title: '删除这条',
                  onClick: () => removeEntry(index),
                  style: { ...button, padding: '4px 8px', opacity: 0.6 },
                },
                '✕',
              ),
            ),
          ),
          h(
            'div',
            { style: row },
            h('button', { type: 'button', onClick: addEntry, style: button }, '+ 加一条'),
            h(
              'button',
              { type: 'button', onClick: save, disabled: busy || drafts === null, style: { ...button, opacity: busy ? 0.5 : 1 } },
              busy ? '保存中…' : '保存',
            ),
            note === null ? null : h('span', { style: { fontSize: 12, opacity: 0.75 } }, note),
          ),
        ),
        // 活动时间线：记忆的触发/更新/关联直观可见
        h(
          'div',
          { style: { borderTop: '1px solid', padding: '8px 12px 10px', maxHeight: '38%', overflowY: 'auto' } },
          h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, '最近活动'),
          activity.length === 0
            ? h('div', { style: { fontSize: 12, opacity: 0.55 } }, '（还没有记录：会话注入和日记写入都会出现在这里）')
            : activity.map((item, index) =>
                h(
                  'div',
                  { key: String(index), style: { fontSize: 12, opacity: 0.8, lineHeight: 1.7, borderBottom: index === activity.length - 1 ? 'none' : '1px dashed rgba(128,128,128,.25)' } },
                  h('span', { style: { opacity: 0.55, marginRight: 6 } }, timeOf(item.t)),
                  h('span', { style: { marginRight: 6 } }, activityGlyph(item)),
                  activityText(item),
                ),
              ),
        ),
      )
    }

    function timeOf(iso) {
      if (typeof iso !== 'string') return ''
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)
      return m === null ? '' : `${m[2]}-${m[3]} ${m[4]}:${m[5]}`
    }

    function activityGlyph(item) {
      if (item.kind === 'inject') return '🧠'
      if (item.kind === 'write') return '✍️'
      return '✏️'
    }

    function activityText(item) {
      if (item.kind === 'inject') return `注入会话（日记 ${String(item.diary)} 条 · 档案 ${String(item.master)} 条）`
      const where = item.target === 'master' ? '主人的档案' : '日记'
      const via = item.via === 'ui' ? '' : ''
      const ops = Array.isArray(item.ops) ? item.ops.join('；') : ''
      return `${where}${via} ${ops}`
    }

    function ensureStyles() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
#${STYLE_ID}-scope textarea, [data-whalechan-diary] textarea { line-height: 1.6; }
`
      document.head.appendChild(style)
    }

    function NativeTabBody() {
      return h(DiaryPanel, { visible: true })
    }

    function mountDiary(ctx, disposers) {
      ensureStyles()

      /** 原生右侧栏 tab（dsh-better-sidebar 不在时才用；id 带作者后缀防撞）。 */
      let nativeDisposer = null
      const dropNative = () => {
        if (nativeDisposer === null) return
        try {
          nativeDisposer()
        } catch {
          // 卸载顺序不可控，安静收尾
        }
        nativeDisposer = null
      }

      if (typeof ctx.inject === 'function') {
        const seat = ctx.inject(['sidebarRightTabs'], (scope) => {
          const tabs = scope.get('sidebarRightTabs')
          if (tabs === undefined || tabs === null || typeof tabs.register !== 'function') return
          if (scope.get('betterSidebar') !== undefined) return // better-sidebar 在，让位
          const disposeType = tabs.register({
            id: NATIVE_KIND,
            kind: NATIVE_KIND,
            priority: 'extension',
            title: () => '🐟️の日记',
            icon: () => whaleIcon(15),
          })
          const disposeBody = ctx.slots
            ? ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: NATIVE_KIND }, NativeTabBody))
            : null
          nativeDisposer = () => {
            if (typeof disposeBody === 'function') disposeBody()
            disposeType()
          }
          return nativeDisposer
        })
        if (typeof seat?.dispose === 'function') disposers.push(() => seat.dispose())
      }

      /** dsh-better-sidebar 装了就走它：registerTab 一个口子搞定左侧导航 + 页面。 */
      if (typeof ctx.inject === 'function') {
        const seat = ctx.inject(['betterSidebar'], (scope) => {
          const better = scope.get('betterSidebar')
          if (better === undefined || better === null || typeof better.registerTab !== 'function') return
          dropNative()
          const descriptor = {
            id: TAB_ID,
            title: () => '🐟️の日记',
            description: () => '鲸鱼娘的跨会话记忆：日记 + 主人的档案 + 最近活动',
            icon: (size) => whaleIcon(typeof size === 'number' ? size : 15),
            order: 60,
            single: true,
            component: (props) =>
              h(DiaryPanel, {
                visible: props === null || props === undefined || props.visible !== false,
              }),
          }
          try {
            const dispose = better.registerTab(descriptor)
            return typeof dispose === 'function' ? dispose : () => {}
          } catch (error) {
            console.warn('whalechan: better-sidebar 注册失败，用原生 tab', error)
            return
          }
        })
        if (typeof seat?.dispose === 'function') disposers.push(() => seat.dispose())
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const disposers = []

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (slots) {
          disposers.push(
            slots.inject('settings.section', () =>
              slots.register({ name: 'settings.section', id: 'whalechan', order: 25, label: '鲸鱼娘' }, () => h(SettingsPanel)),
            ),
          )
        }

        try {
          mountDiary(ctx, disposers)
        } catch (error) {
          console.warn('whalechan: 日记页挂载失败', error)
        }

        return () => {
          for (const dispose of disposers.reverse()) {
            try {
              dispose()
            } catch {
              // 安静收尾
            }
          }
        }
      },
    }
  },
})
