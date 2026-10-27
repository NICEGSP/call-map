window.__ModuleLoader__.load({
  id: 'call-map',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const VIEW_ID = 'calls'
    const SKILL_TOOL = 'skill'
    const MCP_RE = /^mcp__(.+?)__(.+)$/
    const LINE = 'var(--dsw-alias-label-tertiary)'

    let clientCtx = null

    /* ---------------------------------------------------------------- i18n */

    const DICTS = {
      en: {
        tab: 'Call map',
        all: 'All',
        duration: 'Duration',
        turns: 'Turns',
        calls: 'Calls',
        visual: 'Call map',
        skills: 'Skills',
        mcp: 'MCP',
        unused: 'Unused',
        laneInput: 'input',
        laneModel: 'model',
        laneTool: 'tool',
        treePrompt: 'Prompt',
        treeReasoning: 'Reasoning',
        treeTools: 'tools',
        treeNoSkill: 'no skill loaded in this turn',
        treePick: 'Turn',
        treeEmpty: 'This turn called no skill or MCP.',
        treeNoPrompt: 'The prompt of this turn is outside the loaded event window.',
        treeDispatch: 'Subagent',
        treeChild: 'Subagent',
        treeChildPending: 'session not loaded',
        unusedTitle: 'Unused',
        unusedHint: 'Registered and available, but this session never called it.',
        colType: 'Type',
        colName: 'Name / Tool',
        colCount: 'Calls',
        colTurn: 'Turn',
        colTrigger: 'Trigger',
        colResult: 'Result',
        ok: 'ok',
        failed: (n) => n + ' failed',
        never: 'not triggered',
        connected: 'connected, unused',
        empty: 'No skill or MCP call in this session yet.',
        note: 'Trigger shows the reasoning or prompt words that lexically overlap the call — evidence, not proof of causality.',
        typeSkill: 'skill',
        typeMcp: 'MCP',
        loading: 'Reading session events…',
      },
      'zh-CN': {
        tab: '调用可视化',
        all: '全部',
        duration: '时长',
        turns: '轮次',
        calls: '调用',
        visual: '调用可视化',
        skills: '技能',
        mcp: 'MCP',
        unused: '未使用',
        laneInput: '输入',
        laneModel: '模型',
        laneTool: '工具',
        treePrompt: '提示词',
        treeReasoning: '思维链',
        treeTools: '个工具',
        treeNoSkill: '本轮没有加载技能',
        treePick: '轮次',
        treeEmpty: '本轮没有调用技能或 MCP。',
        treeNoPrompt: '这条提示词不在已加载的事件窗口里。',
        treeDispatch: '子代理',
        treeChild: '子代理会话',
        treeChildPending: '会话未加载',
        unusedTitle: '未使用清单',
        unusedHint: '已注册、本会话可用，但一次都没被调用。',
        colType: '类型',
        colName: '名称 / 工具',
        colCount: '次数',
        colTurn: '轮次',
        colTrigger: '触发线索',
        colResult: '结果',
        ok: '成功',
        failed: (n) => n + ' 次报错',
        never: '未触发',
        connected: '已连接未使用',
        empty: '本会话还没有技能或 MCP 调用。',
        note: '触发线索取自思维链与提示词里与调用同名的词面片段，属于证据，不是因果证明。',
        typeSkill: '技能',
        typeMcp: 'MCP',
        loading: '正在读取会话事件…',
      },
    }

    /** cordis throws on touching an un-injected service property; ctx.get() is the safe read. */
    function svc(name) {
      try {
        return clientCtx && typeof clientCtx.get === 'function' ? clientCtx.get(name) : null
      } catch (err) { return null }
    }

    function dictFor(id) {
      const key = typeof id === 'string' && id ? id : 'en'
      if (DICTS[key]) return DICTS[key]
      if (key.toLowerCase().indexOf('zh') === 0) return DICTS['zh-CN']
      return DICTS.en
    }

    function activeLocaleId() {
      try {
        const service = svc('locale')
        if (!service || typeof service.getSnapshot !== 'function') return 'en'
        const snapshot = service.getSnapshot()
        return (snapshot && (snapshot.active || snapshot.id)) || 'en'
      } catch (err) { return 'en' }
    }

    /* ------------------------------------------------------------- folding */

    function textOf(content, types) {
      if (!Array.isArray(content)) return ''
      let out = ''
      for (const block of content) {
        if (!block || typeof block.text !== 'string') continue
        if (types && types.indexOf(block.type) === -1) continue
        out += block.text + '\n'
      }
      return out
    }

    function skillNameOf(raw) {
      if (typeof raw !== 'string' || !raw) return null
      try {
        const value = JSON.parse(raw)
        if (value && typeof value.name === 'string' && value.name) return value.name
        if (value && typeof value.skill === 'string' && value.skill) return value.skill
      } catch (err) { /* not json */ }
      return null
    }

    function skillsFromPrompt(text) {
      const out = []
      if (!text || text.indexOf('<available_skills>') < 0) return out
      const open = text.indexOf('<available_skills>')
      const close = text.indexOf('</available_skills>', open)
      const segment = text.slice(open, close < 0 ? Math.min(text.length, open + 40000) : close)
      const re = /^[ \t]*-[ \t]+`([a-zA-Z0-9][a-zA-Z0-9._-]{0,79})`[ \t]*:/gm
      let match
      while ((match = re.exec(segment))) out.push(match[1])
      return out
    }

    function firstHit(text, words) {
      if (!text) return null
      const haystack = text.toLowerCase()
      let best = null
      for (const word of words) {
        if (!word) continue
        const needle = String(word).toLowerCase()
        if (needle.length < 3) continue
        const at = haystack.indexOf(needle)
        if (at < 0) continue
        if (!best || at < best.at) best = { at: at, word: String(word) }
      }
      return best
    }

    function findAnchor(text, words) {
      const hit = firstHit(text, words)
      if (!hit) return null
      const start = Math.max(0, hit.at - 16)
      const end = Math.min(text.length, hit.at + hit.word.length + 16)
      const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
      return (start > 0 ? '…' : '') + body + (end < text.length ? '…' : '')
    }

    /** Slice a readable window around the first hit and split it into plain / highlighted parts. */
    function chainSlice(text, words, limit) {
      if (!text) return null
      const hit = firstHit(text, words)
      if (!hit) return null
      const start = Math.max(0, hit.at - Math.floor(limit / 4))
      const end = Math.min(text.length, start + limit)
      const slice = Math.round(start) === 0 ? text.slice(0, end) : text.slice(start, end)
      const from = Math.round(start)
      const at = text.toLowerCase().indexOf(hit.word.toLowerCase(), from)
      const local = at >= 0 && at + hit.word.length <= from + slice.length ? at - from : -1
      const parts = []
      if (local < 0) {
        parts.push({ text: slice, hit: false })
      } else {
        if (local > 0) parts.push({ text: slice.slice(0, local), hit: false })
        parts.push({ text: slice.slice(local, local + hit.word.length), hit: true })
        if (local + hit.word.length < slice.length) parts.push({ text: slice.slice(local + hit.word.length), hit: false })
      }
      return { parts, prefix: from > 0, suffix: end < text.length, word: hit.word }
    }

    /** Window around the first match, with every target word coloured by the node it leads to. */
    function markupSlice(text, markers, limit) {
      if (!text || !markers.length) return null
      const lower = text.toLowerCase()
      let first = -1
      for (const marker of markers) {
        const needle = String(marker.word || '').toLowerCase()
        if (needle.length < 3) continue
        const at = lower.indexOf(needle)
        if (at >= 0 && (first < 0 || at < first)) first = at
      }
      if (first < 0) return null
      const start = Math.max(0, first - Math.floor(limit / 4))
      const end = Math.min(text.length, start + limit)
      const slice = text.slice(start, end)
      const sliceLower = slice.toLowerCase()
      const hits = []
      for (const marker of markers) {
        const needle = String(marker.word || '').toLowerCase()
        if (needle.length < 3) continue
        let from = 0
        while (from < sliceLower.length) {
          const at = sliceLower.indexOf(needle, from)
          if (at < 0) break
          hits.push({ start: at, end: at + needle.length, color: marker.color })
          from = at + needle.length
        }
      }
      if (!hits.length) return null
      hits.sort((a, b) => a.start - b.start)
      const parts = []
      let cursor = 0
      for (const hit of hits) {
        if (hit.start < cursor) continue
        if (hit.start > cursor) parts.push({ text: slice.slice(cursor, hit.start), color: null })
        parts.push({ text: slice.slice(hit.start, hit.end), color: hit.color })
        cursor = hit.end
      }
      if (cursor < slice.length) parts.push({ text: slice.slice(cursor), color: null })
      return { parts, prefix: start > 0, suffix: end < text.length }
    }

    const DISPATCH_TOOLS = { spawn_teammate: true, subagent: true, subagent_fork: true, workflow: true, ralph: true }
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

    function dispatchLabel(tool, raw) {
      let value = null
      try { value = raw ? JSON.parse(raw) : null } catch (err) { value = null }
      if (value && typeof value === 'object') {
        for (const key of ['name', 'label', 'description', 'task', 'title']) {
          if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim().replace(/\s+/g, ' ').slice(0, 56)
        }
      }
      return tool
    }

    function childIdsOf(data) {
      const out = []
      const push = (text) => {
        if (typeof text !== 'string' || !text) return
        const found = text.match(UUID_RE)
        if (!found) return
        for (const id of found) if (out.indexOf(id) < 0) out.push(id)
      }
      push(textOf(data.message && data.message.content, ['text']))
      try { push(JSON.stringify(data.meta == null ? null : data.meta)) } catch (err) { /* ignore */ }
      return out
    }

    function analyse(window) {
      const skills = new Map()
      const mcp = new Map()
      const byCall = new Map()
      const dispatchByCall = new Map()
      const openTool = new Map()
      const segments = []
      const turnMarks = []
      const seenTurn = new Set()
      const availSkills = []
      const seenSkill = new Set()
      const availServers = []
      const seenServer = new Set()
      const turns = []
      let current = null
      let currentSkill = null
      let lastReasoning = ''
      let lastPrompt = ''
      let prevTime = null
      let t0 = null
      let t1 = null
      let toolCalls = 0

      function openTurn(number, time) {
        if (current && current.turn === number) return current
        // The user message arrives before turn/start: adopt that provisional record
        // instead of opening a second one and dropping the prompt we just captured.
        if (current && current.turn == null && number != null) {
          current.turn = number
          if (current.time == null) current.time = time
          return current
        }
        current = { turn: number, time, promptText: '', reasoningText: '', skills: [], tools: {}, rootTools: {}, dispatches: [] }
        currentSkill = null
        turns.push(current)
        return current
      }

      function bucketFor(map, key, skill, toolName) {
        let entry = map[key]
        if (!entry) { entry = { key, skill, tool: toolName, count: 0 }; map[key] = entry }
        entry.count += 1
        return entry
      }

      const entries = window && Array.isArray(window.entries) ? window.entries : []
      for (const entry of entries) {
        if (!entry || entry.type !== 'event' || !entry.event) continue
        const event = entry.event
        const data = event.data
        if (!data) continue

        const time = typeof event.time === 'number' ? event.time : prevTime
        if (time != null) {
          if (t0 == null || time < t0) t0 = time
          if (t1 == null || time > t1) t1 = time
        }

        // user/message carries the message itself; other events carry data.message.
        const content = (data.message && data.message.content) || data.content || null
        if (Array.isArray(content)) {
          for (const block of content) {
            if (!block || typeof block.text !== 'string' || block.text.indexOf('<available_skills>') < 0) continue
            for (const name of skillsFromPrompt(block.text)) {
              if (seenSkill.has(name)) continue
              seenSkill.add(name)
              availSkills.push(name)
            }
          }
        }

        if (event.type === 'turn/start') {
          openTurn(data.turn, time)
          if (data.turn != null && !seenTurn.has(data.turn)) {
            seenTurn.add(data.turn)
            turnMarks.push({ turn: data.turn, time })
          }
        } else if (event.type === 'user/message') {
          lastPrompt = textOf(content, ['text'])
          const record = current || openTurn(null, time)
          if (!record.promptText) record.promptText = lastPrompt
          if (time != null) segments.push({ lane: 'input', start: time, end: time, turn: record.turn })
        } else if (event.type === 'assistant/message') {
          lastReasoning = textOf(data.message && data.message.content, ['reasoning', 'text'])
          const record = current || openTurn(data.turn == null ? null : data.turn, time)
          if (!record.reasoningText) record.reasoningText = lastReasoning
          if (time != null && prevTime != null && time >= prevTime) {
            segments.push({ lane: 'model', start: prevTime, end: time, turn: data.turn })
          }
        } else if (event.type === 'request/header') {
          const tools = data.header && data.header.tools
          if (Array.isArray(tools)) {
            for (const tool of tools) {
              const match = tool && typeof tool.name === 'string' ? MCP_RE.exec(tool.name) : null
              if (!match || seenServer.has(match[1])) continue
              seenServer.add(match[1])
              availServers.push(match[1])
            }
          }
        } else if (event.type === 'tool/call') {
          toolCalls += 1
          if (data.turn != null && !seenTurn.has(data.turn)) {
            seenTurn.add(data.turn)
            turnMarks.push({ turn: data.turn, time })
          }
          if (time != null) {
            const segment = { lane: 'tool', start: time, end: time, turn: data.turn, label: String(data.name || '') }
            segments.push(segment)
            if (data.callId != null) openTool.set(String(data.callId), segment)
          }
          if (typeof data.name !== 'string') continue
          const record = current || openTurn(data.turn == null ? null : data.turn, time)
          let row = null
          let treeLabel = null
          if (DISPATCH_TOOLS[data.name]) {
            const dispatch = { key: 'd:' + String(data.callId), tool: data.name, label: dispatchLabel(data.name, data.arguments), childIds: [], callId: data.callId }
            record.dispatches.push(dispatch)
            if (data.callId != null) dispatchByCall.set(String(data.callId), dispatch)
            continue
          }
          if (data.name === SKILL_TOOL) {
            const name = skillNameOf(data.arguments)
            if (!name) continue
            treeLabel = name
            if (record.skills.indexOf(name) < 0) record.skills.push(name)
            currentSkill = name
            const words = [name, String(name).split(/[-_/]/)[0]]
            const key = 'skill:' + name
            row = skills.get(key)
            if (!row) {
              row = {
                kind: 'skill', label: name, key, count: 0, failed: 0,
                turn: data.turn, time: event.time, callId: data.callId, words,
                promptText: lastPrompt.slice(-4000), reasoningText: lastReasoning.slice(-6000),
                anchor: null, unused: false,
              }
              row.anchor = findAnchor(row.reasoningText, words) ? { from: 'reasoning', text: findAnchor(row.reasoningText, words) }
                : (findAnchor(row.promptText, words) ? { from: 'prompt', text: findAnchor(row.promptText, words) } : null)
              skills.set(key, row)
            }
          } else {
            const match = MCP_RE.exec(data.name)
            if (!match) continue
            const toolLabel = match[1] + ' · ' + match[2]
            treeLabel = toolLabel
            if (currentSkill) bucketFor(record.tools, currentSkill + '|' + toolLabel, currentSkill, toolLabel)
            else bucketFor(record.rootTools, toolLabel, null, toolLabel)
            const words = [match[2], match[1]]
            const key = 'mcp:' + data.name
            row = mcp.get(key)
            if (!row) {
              row = {
                kind: 'mcp', label: toolLabel, key, count: 0, failed: 0,
                turn: data.turn, time: event.time, callId: data.callId, words,
                promptText: lastPrompt.slice(-4000), reasoningText: lastReasoning.slice(-6000),
                anchor: null, unused: false,
              }
              row.anchor = findAnchor(row.reasoningText, words) ? { from: 'reasoning', text: findAnchor(row.reasoningText, words) }
                : (findAnchor(row.promptText, words) ? { from: 'prompt', text: findAnchor(row.promptText, words) } : null)
              mcp.set(key, row)
            }
          }
          row.count += 1
          row.turn = data.turn
          row.time = event.time
          row.callId = data.callId
          if (data.callId != null) byCall.set(String(data.callId), row)
          if (record && record.turn == null && data.turn != null) record.turn = data.turn
        } else if (event.type === 'tool/result') {
          const callId = data.message && data.message.toolCallId
          const callSegment = callId != null ? openTool.get(String(callId)) : null
          if (callSegment && time != null) {
            callSegment.end = time
            openTool.delete(String(callId))
          }
          const dispatch = callId != null ? dispatchByCall.get(String(callId)) : null
          if (dispatch) {
            for (const id of childIdsOf(data)) {
              if (dispatch.childIds.indexOf(id) < 0) dispatch.childIds.push(id)
            }
          }
          const row = callId != null ? byCall.get(String(callId)) : null
          if (row && (data.error || (data.message && data.message.isError))) row.failed += 1
        }

        if (time != null) prevTime = time
      }

      const usedSkills = new Set()
      const usedServers = new Set()
      const rows = []
      for (const row of skills.values()) { usedSkills.add(row.label); rows.push(row) }
      for (const row of mcp.values()) { usedServers.add(row.label.split(' · ')[0]); rows.push(row) }

      for (const name of availSkills) {
        if (usedSkills.has(name)) continue
        rows.push({ kind: 'skill', label: name, key: 'skill:unused:' + name, count: 0, failed: 0, turn: null, time: null, callId: null, anchor: null, unused: true })
      }
      for (const server of availServers) {
        if (usedServers.has(server)) continue
        rows.push({ kind: 'mcp', label: server, key: 'mcp:unused:' + server, count: 0, failed: 0, turn: null, time: null, callId: null, anchor: null, unused: true })
      }

      let unused = 0
      for (const row of rows) if (row.unused) unused += 1

      // Compress idle gaps: a two-hour session must not collapse into one cluster.
      const realT0 = t0
      const realT1 = t1
      const marks = []
      for (const segment of segments) { marks.push(segment.start); marks.push(segment.end) }
      for (const mark of turnMarks) if (mark.time != null) marks.push(mark.time)
      marks.sort((a, b) => a - b)
      const axis = new Map()
      let acc = 0
      let previous = null
      for (const at of marks) {
        if (previous != null) acc += Math.min(Math.max(0, at - previous), 2000)
        axis.set(at, acc)
        previous = at
      }
      for (const segment of segments) { segment.start = axis.get(segment.start); segment.end = axis.get(segment.end) }
      for (const mark of turnMarks) if (mark.time != null) mark.time = axis.get(mark.time)

      return {
        rows,
        turns,
        segments,
        turnMarks,
        skillCount: skills.size,
        mcpCount: mcp.size,
        unusedCount: unused,
        toolCalls,
        turnCount: turnMarks.length,
        durationMs: realT0 != null && realT1 != null ? Math.max(0, realT1 - realT0) : 0,
        t0: 0,
        t1: acc,
        ready: entries.length > 0,
      }
    }

    /* --------------------------------------------------------------- hooks */

    function useSessionEvents(sessionId) {
      const source = React.useMemo(() => {
        try {
          const sessions = svc('sessions')
          if (!sessions || typeof sessions.binding !== 'function') return null
          const binding = sessions.binding(sessionId)
          return (binding && binding.eventSource) || null
        } catch (err) { return null }
      }, [sessionId])

      const subscribe = React.useCallback(
        (notify) => (source && typeof source.subscribe === 'function' ? source.subscribe(notify) : () => {}),
        [source],
      )
      const getSnapshot = React.useCallback(
        () => (source && typeof source.getSnapshot === 'function' ? source.getSnapshot() : null),
        [source],
      )
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    function useLocaleSnapshot() {
      const service = svc('locale')
      const subscribe = React.useCallback(
        (notify) => (service && typeof service.subscribe === 'function' ? service.subscribe(notify) : () => {}),
        [service],
      )
      const getSnapshot = React.useCallback(
        () => (service && typeof service.getSnapshot === 'function' ? service.getSnapshot() : null),
        [service],
      )
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    /** Retain each dispatched child session and fold its own skill/MCP usage. */
    function useChildSessions(ids) {
      const key = (ids || []).join(',')
      const [state, setState] = React.useState({})
      React.useEffect(() => {
        const sessions = svc('sessions')
        if (!sessions || !key) { setState({}); return undefined }
        const refs = []
        const unsubs = []
        let live = true
        for (const id of key.split(',')) {
          try {
            refs.push(sessions.retain(id, { source: 'gateway' }))
            const binding = sessions.binding(id)
            const source = binding && binding.eventSource
            if (!source) continue
            const read = () => {
              if (!live) return
              let summary = null
              try { summary = analyse(source.getSnapshot()) } catch (err) { summary = null }
              if (!summary) return
              setState((previous) => Object.assign({}, previous, { [id]: summary }))
            }
            read()
            if (typeof source.subscribe === 'function') unsubs.push(source.subscribe(read))
          } catch (err) { /* child not openable from this client */ }
        }
        return () => {
          live = false
          for (const off of unsubs) { try { off() } catch (err) { /* ignore */ } }
          for (const ref of refs) { try { ref.release() } catch (err) { /* ignore */ } }
        }
      }, [key])
      return state
    }

    /* -------------------------------------------------------------- styles */

    const C = {
      skill: 'var(--dsw-alias-state-success-primary)',
      mcp: 'var(--dsw-alias-state-warn-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
      down: 'var(--dsw-alias-state-error-primary)',
      input: 'var(--dsw-alias-label-tertiary)',
      model: 'var(--dsw-alias-state-warn-primary)',
      tool: 'var(--dsw-alias-brand-primary)',
      prompt: 'var(--dsw-alias-brand-primary)',
      reasoning: 'var(--dsw-alias-state-business-primary)',
      dispatch: '#c084fc',
      child: '#22d3ee',
    }

    const GRID = '46px minmax(0, 1fr) 34px 40px'

    function toneOf(kind) {
      return kind === 'skill' ? C.skill : C.mcp
    }

    function durationText(ms) {
      const total = Math.round(ms / 1000)
      if (total < 60) return total + 's'
      const minutes = Math.floor(total / 60)
      if (minutes < 60) return minutes + 'm ' + (total % 60) + 's'
      return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm'
    }

    const S = {
      root: {
        height: '100%',
        overflow: 'auto',
        boxSizing: 'border-box',
        padding: '12px 18px 48px',
        fontFamily: 'var(--dsw-font-family)',
        fontSize: 13,
        color: 'var(--dsw-alias-label-primary)',
      },
      bar: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
      pill: (active, color) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 8,
        fontFamily: 'inherit',
        fontSize: 12,
        lineHeight: '18px',
        cursor: 'pointer',
        background: active ? 'var(--dsw-alias-bg-layer-3)' : 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid ' + (active ? 'var(--dsw-alias-border-l2)' : 'var(--dsw-alias-border-l1)'),
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
      }),
      dot: (color) => ({ width: 6, height: 6, borderRadius: 3, background: color, flex: '0 0 auto' }),
      stat: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 8,
        fontSize: 12,
        lineHeight: '18px',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      divider: { width: 1, height: 18, background: 'var(--dsw-alias-border-l2)', margin: '0 2px' },
      chart: { position: 'relative', marginBottom: 12, marginTop: 2, padding: '3px 0 5px', borderTop: '1px solid var(--dsw-alias-border-l1)', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      grid: { position: 'absolute', left: 38, right: 0, top: 3, bottom: 5, pointerEvents: 'none' },
      laneRow: { display: 'flex', alignItems: 'center', gap: 8, height: 15 },
      laneTrack: { position: 'relative', flex: '1 1 auto', height: 15 },
      lane: { display: 'flex', alignItems: 'center', gap: 8, height: 20 },
      laneLabel: {
        width: 34,
        flex: '0 0 34px',
        fontSize: 10.5,
        color: 'var(--dsw-alias-label-tertiary)',
        textAlign: 'right',
      },
      track: {
        position: 'relative',
        flex: '1 1 auto',
        height: 12,
        borderRadius: 3,
        background: 'var(--dsw-alias-bg-layer-2)',
        overflow: 'hidden',
      },
      seg: (lane) => ({
        position: 'absolute',
        top: 0,
        bottom: 0,
        minWidth: 3,
        borderRadius: 2,
        background: lane === 'input' ? C.input : (lane === 'model' ? C.model : C.tool),
        opacity: lane === 'model' ? 0.75 : 0.9,
      }),
      ticks: { display: 'flex', alignItems: 'center', gap: 8, height: 16, marginTop: 2 },
      tickTrack: { position: 'relative', flex: '1 1 auto', height: 12 },
      tick: {
        position: 'absolute',
        top: 0,
        fontSize: 9.5,
        color: 'var(--dsw-alias-label-dimmed)',
        transform: 'translateX(-50%)',
        whiteSpace: 'nowrap',
      },

      stream: { display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 940 } ,
      turnGroup: { display: 'flex', flexDirection: 'column', alignItems: 'stretch' },
      turnBadge: { alignSelf: 'flex-start', marginBottom: 6, padding: '1px 7px', borderRadius: 6, fontSize: 10.5, color: 'var(--dsw-alias-label-tertiary)', border: '1px solid var(--dsw-alias-border-l1)' },
      childList: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, marginLeft: 12 },
      childCard: { background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '7px 10px' },
      childHead: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
      childName: { fontSize: 11.5, color: 'var(--dsw-alias-label-primary)', fontWeight: 600 },
      treeWrap: { display: 'flex', alignItems: 'flex-start', gap: 14, marginTop: 8, marginBottom: 14 },
      zoomHost: { position: 'relative', flex: '1 1 auto', minWidth: 0, height: 'calc(100vh - 240px)', overflow: 'hidden', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10, background: 'var(--dsw-alias-bg-layer-1)', cursor: 'grab', padding: 18, boxSizing: 'border-box' },
      zoomBadge: { position: 'absolute', right: 10, bottom: 10, padding: '2px 8px', borderRadius: 6, fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)' },
      zoomHint: { position: 'absolute', right: 10, bottom: 34, fontSize: 10.5, color: 'var(--dsw-alias-label-dimmed)' },
      zoomFit: { position: 'absolute', right: 74, bottom: 10, padding: '2px 8px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)', fontFamily: 'inherit' },
      treeScroll: { flex: '1 1 auto', minWidth: 0, overflowX: 'auto', paddingBottom: 4 },
      treeInner: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', minWidth: 0, maxWidth: 880, width: '100%' },
      sideCol: { flex: '0 0 336px', width: 336, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' },
      node: {
        display: 'flex',
        alignItems: 'stretch',
        gap: 9,
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        padding: '8px 12px 9px',
        boxSizing: 'border-box',
        maxWidth: '100%',
      },
      rowsWrap: { marginLeft: 11, paddingTop: 14, borderLeft: '1px solid ' + LINE },
      branchRow: { display: 'flex', alignItems: 'flex-start', paddingTop: 12 },
      gutter: { position: 'relative', width: 12, flex: '0 0 12px', height: 1 },
      gutterElbow: { position: 'absolute', left: 0, top: 18, width: 12, height: 1, background: LINE },
      branchBody: { flex: '1 1 auto', minWidth: 0, paddingBottom: 4 },
      toolList: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, marginLeft: 12 },
      toolRow: { display: 'flex', alignItems: 'center', gap: 6 },
      toolElbow: { width: 10, flex: '0 0 10px', height: 1, background: LINE },
      toolName: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' },
      rail: (color) => ({ width: 3, borderRadius: 2, background: color, flex: '0 0 3px', opacity: 0.9 }),
      nodeBody: { minWidth: 0 },
      nodeHead: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 },
      nodeTitle: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap' },
      nodeExtra: { fontSize: 10.5, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' },
      nodeText: { fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-word' },
      mark: (color) => ({
        background: 'transparent',
        color: color,
        fontWeight: 600,
        borderBottom: '1px solid ' + color,
      }),
      stem: { width: 1, background: LINE, margin: '0 auto' },
      bus: { height: 1, background: LINE },
      chip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 6,
        fontSize: 11,
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
        maxWidth: 210,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      chipsRow: { display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 6, maxWidth: 420 },
      sideCard: {
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        padding: '10px 10px',
      },
      sideRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0' },
      sideName: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      sideHint: { fontSize: 10.5, color: 'var(--dsw-alias-label-dimmed)', lineHeight: 1.55, marginTop: 6 },

      head: {
        display: 'grid',
        gridTemplateColumns: GRID,
        gap: 8,
        alignItems: 'center',
        padding: '0 6px 8px',
        fontSize: 11,
        color: 'var(--dsw-alias-label-tertiary)',
        borderBottom: '1px solid var(--dsw-alias-border-l2)',
      },
      row: (dim, clickable) => ({
        display: 'grid',
        gridTemplateColumns: GRID,
        gap: 8,
        alignItems: 'center',
        padding: '7px 6px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        opacity: dim ? 0.55 : 1,
        cursor: clickable ? 'pointer' : 'default',
      }),
      rowMain: { minWidth: 0 },
      rowName: {
        fontSize: 12,
        color: 'var(--dsw-alias-label-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      rowTrigger: {
        fontSize: 10.5,
        color: 'var(--dsw-alias-label-dimmed)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        marginTop: 1,
      },
      typeChip: (color) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '.02em',
        color,
      }),
      name: { fontSize: 12.5, color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      num: { fontSize: 12.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-secondary)' },
      turn: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' },
      trigger: {
        fontSize: 11.5,
        color: 'var(--dsw-alias-label-secondary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      result: { fontSize: 11.5, textAlign: 'right', color: 'var(--dsw-alias-label-secondary)' },
      note: { marginTop: 12, fontSize: 11, lineHeight: 1.6, color: 'var(--dsw-alias-label-dimmed)', maxWidth: 720 },
      empty: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 160,
        fontSize: 12.5,
        color: 'var(--dsw-alias-label-tertiary)',
      },
      crash: {
        margin: '12px 18px',
        padding: '10px 12px',
        borderRadius: 8,
        fontFamily: 'var(--dsw-font-family)',
        fontSize: 12,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        color: 'var(--dsw-alias-state-error-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-state-error-primary)',
      },
    }

    /* ----------------------------------------------------------- component */

    function LaneChart(props) {
      const { data, dict } = props
      const span = data.t1 != null && data.t0 != null ? Math.max(1, data.t1 - data.t0) : 1
      const pos = (value) => ((value - data.t0) / span) * 100
      const lanes = [
        { lane: 'input', label: dict.laneInput, color: '#e6d9a2' },
        { lane: 'model', label: dict.laneModel, color: '#dda0a0' },
        { lane: 'tool', label: dict.laneTool, color: '#dd8f3c' },
      ]

      return h('div', { style: S.chart },
        h('div', { style: S.grid },
          data.turnMarks.map((mark) => h('div', {
            key: 'grid' + String(mark.turn),
            style: { position: 'absolute', top: 0, bottom: 0, width: 1, left: pos(mark.time) + '%', background: 'rgba(255,255,255,.055)' },
          }))),
        lanes.map((lane) => h('div', { key: lane.lane, style: S.laneRow },
          h('span', { style: S.laneLabel }, lane.label),
          h('div', { style: S.laneTrack },
            data.segments.filter((segment) => segment.lane === lane.lane).map((segment, index) => {
              const left = pos(segment.start)
              const width = Math.max(0, pos(segment.end) - left)
              return h('div', {
                key: lane.lane + index,
                style: {
                  position: 'absolute', top: 2, bottom: 2,
                  left: left + '%', width: width + '%',
                  minWidth: 2, borderRadius: 2,
                  background: lane.color, opacity: lane.lane === 'input' ? 0.7 : 0.92,
                },
                title: (segment.label ? segment.label + ' · ' : '') + (segment.turn != null ? '#' + segment.turn : ''),
              })
            }),
          ),
        )),
      )
    }

    function NodeCard(props) {
      const { title, color, extra, slice, fallback, wide, chips } = props
      return h('div', { style: S.node },
        h('span', { style: S.rail(color) }),
        h('div', { style: S.nodeBody },
          h('div', { style: S.nodeHead },
            h('span', { style: S.dot(color) }),
            h('span', { style: S.nodeTitle }, title),
            extra ? h('span', { style: S.nodeExtra }, extra) : null,
          ),
          slice || fallback
            ? h('div', { style: S.nodeText },
                slice
                  ? [
                      slice.prefix ? h('span', { key: 'pre' }, '…') : null,
                      slice.parts.map((part, index) => (part.hit || part.color)
                        ? h('mark', { key: 'hit' + index, style: S.mark(part.color || color) }, part.text)
                        : h('span', { key: 'txt' + index }, part.text)),
                      slice.suffix ? h('span', { key: 'suf' }, '…') : null,
                    ]
                  : fallback,
              )
            : null,
          chips && chips.length
            ? h('div', { style: S.chipsRow }, chips.map((chip, index) =>
                h('span', { key: 'chip' + index, style: S.chip, title: chip.label },
                  h('span', { style: S.dot(chip.tone) }),
                  chip.label)))
            : null,
        ),
      )
    }

    function TurnGroup(props) {
      const { turn, dict, children, onOpen } = props

      const markers = []
      for (const skill of turn.skills) markers.push({ word: skill, color: C.skill })
      for (const key of Object.keys(turn.tools)) {
        const entry = turn.tools[key]
        if (entry && entry.tool) markers.push({ word: String(entry.tool).split(' · ').pop(), color: C.mcp })
      }
      for (const key of Object.keys(turn.rootTools)) {
        const entry = turn.rootTools[key]
        if (entry && entry.tool) markers.push({ word: String(entry.tool).split(' · ').pop(), color: C.mcp })
      }
      for (const dispatch of turn.dispatches) {
        markers.push({ word: dispatch.tool, color: C.dispatch })
        markers.push({ word: dispatch.label, color: C.dispatch })
      }
      const plainSlice = (text, limit) => (text
        ? { parts: [{ text: text.replace(/\s+/g, ' ').slice(0, limit), color: null }], prefix: false, suffix: text.length > limit }
        : null)
      // A prompt with no matching trigger word must still render its text, not an empty card.
      const promptSlice = markupSlice(turn.promptText, markers, 200) || plainSlice(turn.promptText, 200)
      const reasoningSlice = markupSlice(turn.reasoningText, markers, 320) || plainSlice(turn.reasoningText, 320)

      const rows = []

      for (const skill of turn.skills) {
        const tools = []
        for (const key of Object.keys(turn.tools)) {
          const entry = turn.tools[key]
          if (!entry || entry.skill !== skill) continue
          tools.push(entry)
        }
        rows.push(h('div', { key: 'b:' + skill, style: S.branchRow },
          h('div', { style: S.gutter }, h('div', { style: S.gutterElbow })),
          h('div', { style: S.branchBody },
            h(NodeCard, {
              title: dict.typeSkill,
              color: C.skill,
              extra: skill,
              slice: { parts: [{ text: skill, hit: true }], prefix: false, suffix: false },
              fallback: null,
            }),
            tools.length
              ? h('div', { style: S.toolList }, tools.map((entry) =>
                  h('div', { key: 't:' + entry.key, style: S.toolRow, title: entry.tool },
                    h('span', { style: S.toolElbow }),
                    h('span', { style: S.toolName }, entry.tool),
                    h('span', { style: S.nodeExtra }, '×' + entry.count))))
              : null,
          ),
        ))
      }

      for (const dispatch of turn.dispatches) {
        const childCards = dispatch.childIds.map((id) => {
          const summary = children ? children[id] : null
          const used = summary ? summary.rows.filter((row) => !row.unused) : []
          const childTitle = dispatch.childTitle && dispatch.childIds.length === 1 ? dispatch.childTitle : null
          return h('div', {
            key: 'c:' + id,
            style: Object.assign({}, S.childCard, { cursor: 'pointer' }),
            title: '打开子会话',
            onClick: () => { if (onOpen) onOpen(id) },
          },
            h('div', { style: S.childHead },
              h('span', { style: S.dot(C.child) }),
              h('span', { style: S.childName }, (childTitle || dict.treeChild) + ' · ' + id.slice(0, 8)),
              summary
                ? h('span', { style: S.nodeExtra }, summary.skillCount + ' ' + dict.skills + ' · ' + summary.mcpCount + ' ' + dict.mcp)
                : h('span', { style: S.nodeExtra }, dict.treeChildPending),
            ),
            used.length
              ? h('div', { style: S.chipsRow }, used.map((row) =>
                  h('span', { key: 'u:' + row.key, style: S.chip, title: row.label },
                    h('span', { style: S.dot(toneOf(row.kind)) }),
                    row.label + ' ×' + row.count)))
              : null,
          )
        })

        rows.push(h('div', { key: 'd:' + dispatch.key, style: S.branchRow },
          h('div', { style: S.gutter }, h('div', { style: S.gutterElbow })),
          h('div', { style: S.branchBody },
            h(NodeCard, {
              title: dict.treeDispatch,
              color: C.dispatch,
              extra: dispatch.tool,
              slice: { parts: [{ text: dispatch.label, hit: true }], prefix: false, suffix: false },
              fallback: null,
            }),
            childCards.length ? h('div', { style: S.childList }, childCards) : null,
          ),
        ))
      }

      const rootTools = Object.keys(turn.rootTools).map((key) => turn.rootTools[key])
      if (rootTools.length) {
        rows.push(h('div', { key: 'b:root', style: S.branchRow },
          h('div', { style: S.gutter }, h('div', { style: S.gutterElbow })),
          h('div', { style: S.branchBody },
            h(NodeCard, {
              title: dict.typeMcp,
              color: C.mcp,
              extra: dict.treeNoSkill,
              slice: null,
              fallback: null,
              chips: rootTools.map((entry) => ({ label: entry.tool + ' ×' + entry.count, tone: C.mcp })),
            }),
          ),
        ))
      }

      return h('div', { style: S.turnGroup },
        h('div', { style: S.turnBadge }, '#' + String(turn.turn == null ? '?' : turn.turn)),
        h(NodeCard, {
          title: dict.treePrompt,
          color: C.prompt,
          wide: true,
          slice: promptSlice,
          fallback: turn.promptText ? null : dict.treeNoPrompt,
        }),
        h('div', { style: Object.assign({}, S.stem, { height: 14 }) }),
        h(NodeCard, {
          title: dict.treeReasoning,
          color: C.reasoning,
          wide: true,
          slice: reasoningSlice,
          fallback: turn.reasoningText ? turn.reasoningText.slice(0, 260) : dict.treeEmpty,
        }),
        rows.length
          ? h('div', { style: S.rowsWrap }, rows)
          : h('div', { style: S.chipsRow }, h('span', { style: S.chip }, dict.treeEmpty)),
      )
    }

    function Stream(props) {
      const { turns, dict, children, onOpen } = props
      if (!turns || !turns.length) return h('div', { style: S.empty }, dict.treeEmpty)
      return h('div', { style: S.stream }, turns.map((turn) =>
        h(TurnGroup, { key: 'turn:' + String(turn.turn), turn, dict, children, onOpen })))
    }

    /** Flatten a workspace snapshot into {id,title} pairs without assuming its exact shape. */
    function collectSessions(snapshot) {
      const out = []
      const seen = {}
      const push = (item) => {
        if (!item || typeof item !== 'object') return
        const id = item.sessionId || item.id
        if (typeof id !== 'string' || seen[id]) return
        seen[id] = true
        out.push({ id: id, title: typeof item.title === 'string' ? item.title : '' })
      }
      const walk = (value, depth) => {
        if (!value || depth > 4) return
        if (Array.isArray(value)) {
          for (const item of value) walk(item, depth + 1)
          return
        }
        if (typeof value !== 'object') return
        if (Array.isArray(value.sessions)) for (const item of value.sessions) push(item)
        for (const key of Object.keys(value)) {
          if (key === 'sessions') continue
          const child = value[key]
          if (child && typeof child === 'object') walk(child, depth + 1)
        }
      }
      walk(snapshot, 0)
      return out
    }

    function ZoomStage(props) {
      const [zoom, setZoom] = React.useState(0.6)
      const [pan, setPan] = React.useState({ x: 0, y: 0 })
      const hostRef = React.useRef(null)
      const contentRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const fittedRef = React.useRef(false)

      React.useEffect(() => {
        const node = hostRef.current
        if (!node) return undefined
        const onWheel = (event) => {
          event.preventDefault()
          const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
          setZoom((current) => Math.min(2.4, Math.max(0.3, current * factor)))
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => node.removeEventListener('wheel', onWheel)
      }, [])

      const fit = React.useCallback(() => {
        const host = hostRef.current
        const content = contentRef.current
        if (!host || !content) return
        const ratio = Math.min(
          host.clientHeight / Math.max(1, content.scrollHeight),
          host.clientWidth / Math.max(1, content.scrollWidth),
          1,
        )
        setZoom(Math.max(0.12, ratio * 0.96))
        setPan({ x: 0, y: 0 })
      }, [])

      const fitLatest = React.useCallback(() => {
        const host = hostRef.current
        const content = contentRef.current
        if (!host || !content) return
        const widthRatio = host.clientWidth / Math.max(1, content.scrollWidth)
        const next = Math.min(1.1, Math.max(0.35, widthRatio))
        setZoom(next)
        setPan({ x: 0, y: Math.min(0, host.clientHeight - content.scrollHeight * next) })
      }, [])

      React.useEffect(() => {
        if (fittedRef.current) return undefined
        const timer = setTimeout(() => {
          fittedRef.current = true
          fitLatest()
        }, 120)
        return () => clearTimeout(timer)
      }, [fitLatest])

      const startDrag = (event) => {
        if (event.button !== 0) return
        dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, moved: false }
      }
      const moveDrag = (event) => {
        const drag = dragRef.current
        if (!drag) return
        const dx = event.clientX - drag.x
        const dy = event.clientY - drag.y
        // A left click is a click until the pointer actually travels.
        if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return
        drag.moved = true
        setPan({ x: drag.panX + dx, y: drag.panY + dy })
      }
      const endDrag = () => { dragRef.current = null }

      return h('div', {
        ref: hostRef,
        style: S.zoomHost,
        onMouseDown: startDrag,
        onMouseMove: moveDrag,
        onMouseUp: endDrag,
        onMouseLeave: endDrag,
      },
        h('div', {
          ref: contentRef,
          style: {
            transform: 'translate(' + pan.x + 'px,' + pan.y + 'px) scale(' + zoom + ')',
            transformOrigin: '0 0',
            width: 'max-content',
            minWidth: '100%',
          },
        }, props.children),
        h('button', { type: 'button', onClick: fitLatest, style: S.zoomFit }, '最新'),
        h('button', { type: 'button', onClick: fit, style: Object.assign({}, S.zoomFit, { right: 128 }) }, '全览'),
        h('div', { style: S.zoomBadge }, Math.round(zoom * 100) + '%'),
        h('div', { style: S.zoomHint }, '滚轮缩放 · 拖拽平移'),
      )
    }

    function TrajectoryBoard(props) {
      const localeSnapshot = useLocaleSnapshot()
      const dict = dictFor(localeSnapshot && (localeSnapshot.active || localeSnapshot.id))
      const sessionId = props && props.sessionId
      const window = useSessionEvents(sessionId)
      const [filter, setFilter] = React.useState('all')
      const [showTable, setShowTable] = React.useState(true)
      const data = React.useMemo(() => analyse(window), [window])


      const workspaceSnapshot = typeof props.useWorkspaces === 'function' ? props.useWorkspaces((value) => value) : null
      const sessionsIndex = React.useMemo(() => collectSessions(workspaceSnapshot), [workspaceSnapshot])

      const streamTurns = React.useMemo(() => {
        const turns = data.turns.filter((turn) => turn.skills.length > 0 || turn.dispatches.length > 0 || Object.keys(turn.rootTools).length > 0)
        return turns.map((turn) => {
          if (!turn.dispatches.length) return turn
          const dispatches = turn.dispatches.map((dispatch) => {
            if (dispatch.childIds.length || dispatch.tool !== 'spawn_teammate') return dispatch
            const wanted = String(dispatch.label || '').trim().toLowerCase()
            if (!wanted) return dispatch
            const hit = sessionsIndex.find((session) => session.id !== sessionId && session.title.trim().toLowerCase() === wanted)
            return hit ? Object.assign({}, dispatch, { childIds: [hit.id], childTitle: hit.title }) : dispatch
          })
          return Object.assign({}, turn, { dispatches })
        })
      }, [data, sessionsIndex, sessionId])
      const childIds = React.useMemo(() => {
        const ids = []
        for (const turn of streamTurns) {
          for (const dispatch of turn.dispatches) {
            for (const id of dispatch.childIds) if (ids.indexOf(id) < 0) ids.push(id)
          }
        }
        return ids
      }, [streamTurns])
      const children = useChildSessions(childIds)
      const openSession = React.useCallback((id) => {
        try {
          const ui = svc('uiWorkspace')
          if (ui && typeof ui.openSession === 'function') ui.openSession(id)
        } catch (err) { /* host owns navigation */ }
      }, [])

      const rows = React.useMemo(() => {
        let list = data.rows
        if (filter === 'skill') list = list.filter((row) => row.kind === 'skill')
        else if (filter === 'mcp') list = list.filter((row) => row.kind === 'mcp')
        else if (filter === 'unused') list = list.filter((row) => row.unused)
        return list.slice().sort((a, b) => {
          if (a.unused !== b.unused) return a.unused ? 1 : -1
          if (b.count !== a.count) return b.count - a.count
          return String(a.label).localeCompare(String(b.label))
        })
      }, [data, filter])

      const pill = (id, label, color) =>
        h('button', {
          key: id,
          type: 'button',
          onClick: () => setFilter(filter === id ? 'all' : id),
          style: S.pill(filter === id, color),
        }, h('span', { style: S.dot(color) }), label)

      const openCall = (row) => {
        if (!row || row.unused || row.callId == null) return
        const inspect = props && props.inspectCall
        if (typeof inspect !== 'function') return
        try { inspect(row.callId) } catch (err) { /* host owns the inspector */ }
      }

      const cell = (row) => {
        const color = row.unused ? C.idle : toneOf(row.kind)
        const trigger = row.anchor ? row.anchor.text : null
        let result = '—'
        if (row.unused) result = row.kind === 'mcp' ? dict.connected : dict.never
        else if (row.failed > 0) result = dict.failed(row.failed)
        else result = dict.ok

        return h('div', {
          key: row.key,
          style: S.row(row.unused, !row.unused && row.callId != null),
          onClick: () => openCall(row),
          onMouseEnter: (event) => { if (!row.unused && row.callId != null) event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)' },
          onMouseLeave: (event) => { event.currentTarget.style.background = 'transparent' },
        },
          h('span', { style: S.typeChip(color) },
            h('span', { style: S.dot(color) }),
            row.kind === 'skill' ? dict.typeSkill : dict.typeMcp),
          h('div', { style: S.rowMain },
            h('div', { style: S.rowName, title: row.label }, row.label),
            h('div', { style: S.rowTrigger, title: trigger || '' },
              (row.turn == null ? '—' : '#' + row.turn) + (trigger ? ' · ' + trigger : '')),
          ),
          h('span', { style: S.num }, String(row.count)),
          h('span', { style: Object.assign({}, S.result, row.failed > 0 ? { color: C.down } : null) }, result),
        )
      }

      try {
        if (!data.ready) return h('div', { style: S.empty }, dict.loading)

        return h('div', { style: S.root },
          h('div', { style: S.bar },
            h('span', { style: S.stat }, dict.duration + ' ' + durationText(data.durationMs)),
            h('span', { style: S.stat }, dict.turns + ' ' + data.turnCount),
            h('span', { style: S.stat }, dict.calls + ' ' + data.toolCalls),
            h('span', { style: S.divider }),
            h('span', { style: S.stat },
              h('span', { style: S.dot(C.skill) }), dict.skills + ' ' + data.skillCount),
            h('span', { style: S.stat },
              h('span', { style: S.dot(C.mcp) }), dict.mcp + ' ' + data.mcpCount),
            h('span', { style: S.divider }),
            h('button', {
              type: 'button',
              onClick: () => setShowTable(!showTable),
              style: S.pill(showTable, 'var(--dsw-alias-brand-primary)'),
            }, dict.visual),
          ),
          h(LaneChart, { data, dict }),
          h('div', { style: S.treeWrap },
            h(ZoomStage, null, h(Stream, { turns: streamTurns, dict, children, onOpen: openSession })),
            h('div', { style: S.sideCol },
              showTable
                ? h('div', { style: S.sideCard },
                    h('div', { style: S.bar },
                      pill('all', dict.all, 'var(--dsw-alias-brand-primary)'),
                      pill('skill', dict.skills + ' ' + data.skillCount, C.skill),
                      pill('mcp', dict.mcp + ' ' + data.mcpCount, C.mcp),
                      pill('unused', dict.unused + ' ' + data.unusedCount, C.idle),
                    ),
                    h('div', { style: S.head },
                      h('span', null, dict.colType),
                      h('span', null, dict.colName),
                      h('span', { style: { textAlign: 'right' } }, dict.colCount),
                      h('span', { style: { textAlign: 'right' } }, dict.colResult),
                    ),
                    rows.length ? rows.map(cell) : h('div', { style: S.empty }, dict.empty),
                    h('div', { style: S.note }, dict.note),
                  )
                : null,
            ),
          ),
        )
      } catch (err) {
        return h('div', { style: S.crash }, 'call-map: ' + (err && err.message ? err.message : String(err)))
      }
    }

    /* ---------------------------------------------------------------- apply */

    function apply(ctx) {
      clientCtx = ctx

      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: VIEW_ID,
        order: 20,
        label: () => dictFor(activeLocaleId()).tab,
      }, TrajectoryBoard))
    }

    return { inject: ['slots'], apply }
  },
})