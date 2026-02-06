/**
 * Embedded HTML/JS/CSS dashboard for the OpenClaw Inspector.
 *
 * Exported as a single string for serving from the HTTP server.
 * Features: real-time WebSocket feed, Enable/Disable toggle,
 * provider badges, token usage display, collapsible message inspector.
 *
 * @module dashboard
 */

/**
 * Generate the full HTML dashboard.
 *
 * @param {number} port - Inspector proxy port (for display).
 * @returns {string} Complete HTML page.
 */
export function renderDashboard(port) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenClaw Inspector</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,monospace;background:#0d1117;color:#c9d1d9;font-size:13px}
a{color:#58a6ff;text-decoration:none}

/* Header */
.header{background:#161b22;border-bottom:1px solid #30363d;padding:10px 16px;display:flex;align-items:center;gap:16px;position:sticky;top:0;z-index:100}
.header h1{font-size:15px;color:#f0f6fc;white-space:nowrap}
.header h1 span{color:#f78166}
.stats{display:flex;gap:14px;font-size:12px;color:#8b949e;flex-wrap:wrap}
.stats b{color:#c9d1d9}

/* Toggle */
.toggle-area{margin-left:auto;display:flex;gap:8px;align-items:center}
.status-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.status-dot.on{background:#3fb950}
.status-dot.off{background:#484f58}
.btn{padding:5px 12px;border-radius:6px;border:1px solid #30363d;background:#21262d;color:#c9d1d9;cursor:pointer;font-size:12px;font-family:inherit}
.btn:hover{background:#30363d}
.btn.danger{border-color:#f85149;color:#f85149}
.btn.danger:hover{background:#f8514920}
.btn.primary{border-color:#238636;color:#3fb950;background:#238636 20}
.btn.primary:hover{background:#23863640}
.btn:disabled{opacity:.5;cursor:not-allowed}

/* Entries */
.entries{padding:8px}
.entry{background:#161b22;border:1px solid #30363d;border-radius:6px;margin-bottom:6px;overflow:hidden}
.entry-header{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;user-select:none}
.entry-header:hover{background:#1c2128}
.entry.expanded .entry-header{border-bottom:1px solid #30363d}
.badge{padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;text-transform:uppercase}
.badge.anthropic{background:#d4a27420;color:#d4a274}
.badge.openai{background:#10a37f20;color:#10a37f}
.badge.byteplus{background:#3b82f620;color:#60a5fa}
.badge.ollama{background:#8b5cf620;color:#a78bfa}
.badge.google{background:#ea433520;color:#f87171}
.badge.groq{background:#f59e0b20;color:#fbbf24}
.badge.default{background:#48505820;color:#8b949e}
.method{color:#8b949e;font-size:11px;width:36px}
.path{color:#8b949e;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.model-name{color:#79c0ff;font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tokens{font-size:11px;color:#8b949e;white-space:nowrap}
.tokens b{color:#c9d1d9}
.duration{font-size:11px;color:#8b949e;width:60px;text-align:right}
.status-code{font-size:11px;font-weight:600;width:28px;text-align:center}
.status-code.s2{color:#3fb950}
.status-code.s4{color:#f85149}
.status-code.s5{color:#f85149}
.status-code.pending{color:#d29922}
.timestamp{font-size:11px;color:#484f58;width:70px;text-align:right}

/* Detail panel */
.detail{display:none;padding:12px;background:#0d1117;border-top:1px solid #21262d}
.entry.expanded .detail{display:block}
.tabs{display:flex;gap:0;margin-bottom:10px;border-bottom:1px solid #30363d}
.tab{padding:6px 14px;cursor:pointer;color:#8b949e;font-size:12px;border-bottom:2px solid transparent}
.tab:hover{color:#c9d1d9}
.tab.active{color:#f0f6fc;border-bottom-color:#f78166}
.tab-content{display:none}
.tab-content.active{display:block}
pre.json{background:#161b22;padding:10px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;font-size:12px;max-height:500px;overflow-y:auto;border:1px solid #21262d}

/* Messages view */
.msg{margin-bottom:8px;padding:8px 10px;border-radius:4px;border-left:3px solid #30363d}
.msg.system{border-color:#d29922;background:#d2992210}
.msg.user{border-color:#58a6ff;background:#58a6ff10}
.msg.assistant{border-color:#3fb950;background:#3fb95010}
.msg.tool,.msg.toolResult{border-color:#bc8cff;background:#bc8cff10}
.msg.developer{border-color:#f78166;background:#f7816610}
.msg-role{font-size:11px;font-weight:600;text-transform:uppercase;margin-bottom:4px}
.msg-role.system{color:#d29922}
.msg-role.user{color:#58a6ff}
.msg-role.assistant{color:#3fb950}
.msg-role.tool,.msg-role.toolResult{color:#bc8cff}
.msg-role.developer{color:#f78166}
.msg-text{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5}
.tool-badge{display:inline-block;padding:1px 5px;border-radius:3px;background:#bc8cff20;color:#bc8cff;font-size:11px;font-weight:600;margin-right:4px}
.thinking{color:#8b949e;font-style:italic}

/* Collapsible blocks */
.collapsible{cursor:pointer;user-select:none}
.collapsible::before{content:'▶ ';font-size:10px;display:inline-block;transition:transform .15s;color:#8b949e}
.collapsible.open::before{transform:rotate(90deg)}
.collapse-body{display:none;margin-top:6px}
.collapsible.open+.collapse-body{display:block}
.collapsible.open~.msg-text{display:none}
.msg-count{font-size:10px;color:#484f58;margin-left:6px;font-weight:400}
.tool-name{color:#d2a8ff;font-weight:600}
.tool-id{color:#484f58;font-size:10px;margin-left:4px}

/* Empty state */
.empty{text-align:center;padding:60px;color:#484f58}
.empty h2{font-size:16px;margin-bottom:8px;color:#8b949e}

/* Connection */
.conn{font-size:11px;display:flex;align-items:center;gap:4px}
.conn-dot{width:6px;height:6px;border-radius:50%;background:#484f58}
.conn-dot.connected{background:#3fb950}
</style>
</head>
<body>
<div class="header">
  <h1><span>&#127990;</span> OpenClaw Inspector</h1>
  <div class="stats">
    <span>Requests: <b id="statReqs">0</b></span>
    <span>Tokens: <b id="statTokens">0</b></span>
    <span>Cost: <b id="statCost">$0.00</b></span>
    <span class="conn"><span class="conn-dot" id="connDot"></span> <span id="connLabel">connecting</span></span>
  </div>
  <div class="toggle-area">
    <span class="status-dot off" id="statusDot"></span>
    <span id="statusLabel" style="font-size:12px;color:#8b949e">checking...</span>
    <button class="btn primary" id="btnEnable" disabled>Enable</button>
    <button class="btn danger" id="btnDisable" disabled>Disable</button>
    <button class="btn" id="btnClear">Clear</button>
  </div>
</div>
<div class="entries" id="entries">
  <div class="empty" id="emptyState">
    <h2>No requests yet</h2>
    <p>Enable interception and send a message to your OpenClaw bot</p>
  </div>
</div>

<script>
const PORT = ${port};
let ws = null;
let reconnectTimer = null;
let totalReqs = 0, totalTokens = 0, totalCost = 0;
const entryEls = new Map();

/* ── Provider badge class ── */
function badgeClass(p) {
  const known = ['anthropic','openai','byteplus','ollama','google','groq'];
  for (const k of known) if (p.includes(k)) return k;
  return 'default';
}

/* ── Format helpers ── */
function fmtTs(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString('en-GB',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function fmtDur(ms) { return ms != null ? ms < 1000 ? ms+'ms' : (ms/1000).toFixed(1)+'s' : '...'; }
function fmtTokens(n) { return n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n); }
function statusClass(s) { if (!s) return 'pending'; return 's'+String(s)[0]; }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ── Stats ── */
function updateStats() {
  document.getElementById('statReqs').textContent = totalReqs;
  document.getElementById('statTokens').textContent = fmtTokens(totalTokens);
  document.getElementById('statCost').textContent = '$' + totalCost.toFixed(4);
}

/* ── Create entry element ── */
function createEntryEl(e) {
  const div = document.createElement('div');
  div.className = 'entry';
  div.dataset.id = e.id;
  div.innerHTML = \`
    <div class="entry-header" onclick="toggleDetail('\${e.id}')">
      <span class="badge \${badgeClass(e.provider)}">\${escHtml(e.provider)}</span>
      <span class="method">\${escHtml(e.method)}</span>
      <span class="model-name">\${escHtml(e.model||'?')}</span>
      <span class="path">\${escHtml(e.path)}</span>
      <span class="tokens" id="tok-\${e.id}">\${renderTokens(e.usage)}</span>
      <span class="status-code \${statusClass(e.status)}" id="st-\${e.id}">\${e.status||'...'}</span>
      <span class="duration" id="dur-\${e.id}">\${fmtDur(e.duration)}</span>
      <span class="timestamp">\${fmtTs(e.timestamp)}</span>
    </div>
    <div class="detail" id="det-\${e.id}"></div>
  \`;
  return div;
}

function renderTokens(u) {
  if (!u || (!u.inputTokens && !u.outputTokens)) return '<span style="color:#484f58">—</span>';
  let s = 'in:<b>'+fmtTokens(u.inputTokens)+'</b> out:<b>'+fmtTokens(u.outputTokens)+'</b>';
  if (u.cachedTokens > 0) s += ' cache:<b>'+fmtTokens(u.cachedTokens)+'</b>';
  return s;
}

/* ── Update entry ── */
function updateEntryEl(e) {
  const tokEl = document.getElementById('tok-'+e.id);
  const stEl = document.getElementById('st-'+e.id);
  const durEl = document.getElementById('dur-'+e.id);
  if (tokEl) tokEl.innerHTML = renderTokens(e.usage);
  if (stEl) { stEl.textContent = e.status||'...'; stEl.className = 'status-code '+statusClass(e.status); }
  if (durEl) durEl.textContent = fmtDur(e.duration);
}

/* ── Toggle detail ── */
function toggleDetail(id) {
  const entry = document.querySelector('.entry[data-id="'+id+'"]');
  if (!entry) return;
  if (entry.classList.contains('expanded')) {
    entry.classList.remove('expanded');
    return;
  }
  entry.classList.add('expanded');
  const det = document.getElementById('det-'+id);
  if (det && !det.dataset.loaded) {
    det.innerHTML = '<p style="color:#8b949e;padding:8px">Loading...</p>';
    det.dataset.loaded = '1';
    ws?.send(JSON.stringify({action:'detail',id}));
  }
}

/* ── Collapsible toggle ── */
function toggleCollapse(el) {
  el.classList.toggle('open');
}

/* ── Unique counter for collapsible IDs ── */
let _cid = 0;
function cid() { return 'c' + (++_cid); }

/* ── Render detail panel ── */
function renderDetail(entry) {
  const det = document.getElementById('det-'+entry.id);
  if (!det) return;
  det.dataset.loaded = '1';

  // ── Build messages from request body ──
  let messagesHtml = '';
  const req = entry.reqBody;
  if (req && typeof req === 'object') {
    if (req.system) {
      const sys = Array.isArray(req.system) ? req.system.map(b=>b.text||'').join('\\n') : String(req.system);
      messagesHtml += renderCollapsibleMsg('system', 'system', sys);
    }
    if (Array.isArray(req.messages)) {
      for (const m of req.messages) {
        messagesHtml += renderMessage(m);
      }
    }
  }

  // ── Response content (from SSE events or buffered body) ──
  let responseHtml = '';
  if (Array.isArray(entry.sseEvents) && entry.sseEvents.length > 0) {
    responseHtml = renderSSEResponse(entry.sseEvents, entry.provider);
  } else {
    const res = entry.resBody;
    if (typeof res === 'object' && res !== null) {
      if (Array.isArray(res.content)) {
        responseHtml = renderAnthropicBlocks(res.content);
      } else if (Array.isArray(res.choices)) {
        responseHtml = renderOpenAIChoices(res.choices);
      }
    }
  }

  det.innerHTML = \`
    <div class="tabs">
      <div class="tab active" onclick="switchTab(this,'msgs-\${entry.id}')">Messages (\${Array.isArray(req?.messages)?req.messages.length:0})</div>
      <div class="tab" onclick="switchTab(this,'res-\${entry.id}')">Response</div>
      <div class="tab" onclick="switchTab(this,'req-\${entry.id}')">Request JSON</div>
      <div class="tab" onclick="switchTab(this,'sse-\${entry.id}')">SSE Events (\${entry.sseEvents?.length||0})</div>
      <div class="tab" onclick="switchTab(this,'hdrs-\${entry.id}')">Headers</div>
    </div>
    <div class="tab-content active" id="msgs-\${entry.id}">\${messagesHtml || '<p style="color:#484f58">No messages</p>'}</div>
    <div class="tab-content" id="res-\${entry.id}">\${responseHtml || '<p style="color:#484f58">No response content</p>'}</div>
    <div class="tab-content" id="req-\${entry.id}"><pre class="json">\${escHtml(typeof req==='object'?JSON.stringify(req,null,2):String(req||''))}</pre></div>
    <div class="tab-content" id="sse-\${entry.id}">\${renderSSEEventsTab(entry.sseEvents)}</div>
    <div class="tab-content" id="hdrs-\${entry.id}">
      <h4 style="color:#8b949e;margin-bottom:6px">Request Headers</h4>
      <pre class="json">\${escHtml(JSON.stringify(entry.reqHeaders||{},null,2))}</pre>
      <h4 style="color:#8b949e;margin:10px 0 6px">Response Headers</h4>
      <pre class="json">\${escHtml(JSON.stringify(entry.resHeaders||{},null,2))}</pre>
    </div>
  \`;
}

/* ── Reconstruct response from Anthropic SSE events ── */
function renderSSEResponse(events, provider) {
  // Detect Anthropic vs OpenAI
  const isAnthropic = events.some(e => e.type === 'message_start' || e.type === 'content_block_start');
  if (isAnthropic) return renderAnthropicSSE(events);
  return renderOpenAISSE(events);
}

function renderAnthropicSSE(events) {
  const blocks = []; // { type, text/thinking/name/input }
  let currentBlock = null;

  for (const evt of events) {
    if (evt.type === 'content_block_start' && evt.content_block) {
      currentBlock = { type: evt.content_block.type, text: '', thinking: '', name: evt.content_block.name || '', input: '', id: evt.content_block.id || '' };
      blocks.push(currentBlock);
    }
    if (evt.type === 'content_block_delta' && evt.delta && currentBlock) {
      if (evt.delta.type === 'text_delta') currentBlock.text += evt.delta.text || '';
      if (evt.delta.type === 'thinking_delta') currentBlock.thinking += evt.delta.thinking || '';
      if (evt.delta.type === 'input_json_delta') currentBlock.input += evt.delta.partial_json || '';
    }
    if (evt.type === 'content_block_stop') currentBlock = null;
  }

  let html = '';
  for (const b of blocks) {
    if (b.type === 'thinking') {
      html += renderCollapsibleMsg('assistant', '🧠 thinking', b.thinking, 'thinking');
    } else if (b.type === 'text') {
      html += renderCollapsibleMsg('assistant', 'assistant', b.text);
    } else if (b.type === 'tool_use') {
      let args = b.input;
      try { args = JSON.stringify(JSON.parse(args), null, 2); } catch {}
      html += renderToolCall(b.name, args, b.id);
    }
  }
  return html || '<p style="color:#484f58">Empty response</p>';
}

function renderOpenAISSE(events) {
  let content = '';
  let reasoningContent = '';
  const toolCalls = {}; // index -> { name, args }

  for (const evt of events) {
    if (!evt.choices || !evt.choices[0]) continue;
    const d = evt.choices[0].delta || {};
    if (d.content) content += d.content;
    if (d.reasoning_content) reasoningContent += d.reasoning_content;
    if (Array.isArray(d.tool_calls)) {
      for (const tc of d.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCalls[idx]) toolCalls[idx] = { name: '', args: '' };
        if (tc.function?.name) toolCalls[idx].name = tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].args += tc.function.arguments;
      }
    }
  }

  let html = '';
  if (reasoningContent) {
    html += renderCollapsibleMsg('assistant', '🧠 reasoning', reasoningContent, 'thinking');
  }
  if (content) {
    html += renderCollapsibleMsg('assistant', 'assistant', content);
  }
  for (const [, tc] of Object.entries(toolCalls)) {
    let args = tc.args;
    try { args = JSON.stringify(JSON.parse(args), null, 2); } catch {}
    html += renderToolCall(tc.name, args);
  }
  return html || '<p style="color:#484f58">Empty response</p>';
}

/* ── Render Anthropic content blocks (non-streaming) ── */
function renderAnthropicBlocks(blocks) {
  let html = '';
  for (const b of blocks) {
    if (b.type === 'text') html += renderCollapsibleMsg('assistant', 'assistant', b.text);
    else if (b.type === 'thinking') html += renderCollapsibleMsg('assistant', '🧠 thinking', b.thinking || '', 'thinking');
    else if (b.type === 'tool_use') html += renderToolCall(b.name, JSON.stringify(b.input||{},null,2), b.id);
  }
  return html;
}

/* ── Render OpenAI choices (non-streaming) ── */
function renderOpenAIChoices(choices) {
  let html = '';
  for (const c of choices) {
    const msg = c.message || c.delta || {};
    if (msg.reasoning_content) html += renderCollapsibleMsg('assistant', '🧠 reasoning', msg.reasoning_content, 'thinking');
    if (msg.content) html += renderCollapsibleMsg('assistant', 'assistant', msg.content);
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const fn = tc.function || {};
        let args = fn.arguments || '{}';
        try { args = JSON.stringify(JSON.parse(args),null,2); } catch{}
        html += renderToolCall(fn.name||'?', args, tc.id);
      }
    }
  }
  return html;
}

/* ── Render SSE Events tab ── */
function renderSSEEventsTab(events) {
  if (!events || !events.length) return '<p style="color:#484f58">No SSE events</p>';
  let html = '';
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const evtType = e.type || e.object || 'chunk';
    const id = cid();
    html += '<div style="margin-bottom:4px">';
    html += '<div class="collapsible" onclick="toggleCollapse(this)"><span style="color:#f78166;font-size:11px;font-weight:600">'+escHtml(evtType)+'</span><span class="msg-count">#'+(i+1)+'</span></div>';
    html += '<div class="collapse-body"><pre class="json" style="max-height:300px">'+escHtml(JSON.stringify(e,null,2))+'</pre></div>';
    html += '</div>';
  }
  return html;
}

/* ── Render a message (from request messages array) ── */
function renderMessage(m) {
  const role = m.role || 'unknown';

  // Simple string content
  if (typeof m.content === 'string') {
    if (role === 'tool') return renderToolResult(m.content, m.tool_use_id);
    return renderCollapsibleMsg(role, role, m.content);
  }

  // Array of content blocks (Anthropic)
  if (Array.isArray(m.content)) {
    let html = '';
    for (const block of m.content) {
      if (block.type === 'text') html += renderCollapsibleMsg(role, role, block.text);
      else if (block.type === 'image_url' || block.type === 'image') html += renderSimpleMsg(role, '[📷 image]');
      else if (block.type === 'tool_use') html += renderToolCall(block.name||'?', JSON.stringify(block.input||{},null,2), block.id);
      else if (block.type === 'tool_result') html += renderToolResult(typeof block.content==='string'?block.content:JSON.stringify(block.content), block.tool_use_id);
      else if (block.type === 'thinking') html += renderCollapsibleMsg('assistant', '🧠 thinking', block.thinking||'', 'thinking');
    }
    return html;
  }

  // OpenAI tool_calls
  if (m.tool_calls) {
    let html = m.content ? renderCollapsibleMsg(role, role, m.content) : '';
    for (const tc of m.tool_calls) {
      const fn = tc.function || {};
      let args = fn.arguments || '{}';
      try { args = JSON.stringify(JSON.parse(args),null,2); } catch{}
      html += renderToolCall(fn.name||'?', args, tc.id);
    }
    return html;
  }

  // Tool result (role=tool)
  if (role === 'tool') {
    return renderToolResult(typeof m.content==='string'?m.content:JSON.stringify(m.content), m.tool_call_id);
  }

  return renderCollapsibleMsg(role, role, JSON.stringify(m.content));
}

/* ── Collapsible message block ── */
function renderCollapsibleMsg(roleClass, label, text, extraClass) {
  const r = roleClass === 'tool' ? 'toolResult' : roleClass;
  const preview = (text||'').slice(0, 120).replace(/\\n/g, ' ');
  const len = (text||'').length;
  const needsCollapse = len > 200;
  const cls = extraClass ? ' '+extraClass : '';

  if (!needsCollapse) {
    return '<div class="msg '+r+'"><div class="msg-role '+r+'">'+escHtml(label)+'</div><div class="msg-text'+cls+'">'+escHtml(text||'')+'</div></div>';
  }

  return '<div class="msg '+r+'">'
    + '<div class="msg-role '+r+' collapsible" onclick="toggleCollapse(this)">'+escHtml(label)+'<span class="msg-count">'+fmtTokens(len)+' chars</span></div>'
    + '<div class="collapse-body"><div class="msg-text'+cls+'">'+escHtml(text||'')+'</div></div>'
    + '<div class="msg-text" style="color:#484f58;font-size:11px;max-height:1.5em;overflow:hidden">'+escHtml(preview)+'…</div>'
    + '</div>';
}

/* ── Simple (non-collapsible) message ── */
function renderSimpleMsg(role, text) {
  const r = role === 'tool' ? 'toolResult' : role;
  return '<div class="msg '+r+'"><div class="msg-role '+r+'">'+escHtml(role)+'</div><div class="msg-text">'+escHtml(text||'')+'</div></div>';
}

/* ── Tool call block ── */
function renderToolCall(name, args, id) {
  return '<div class="msg tool">'
    + '<div class="msg-role tool collapsible" onclick="toggleCollapse(this)"><span class="tool-badge">⚡ tool_call</span> <span class="tool-name">'+escHtml(name)+'</span>'+(id?'<span class="tool-id">'+escHtml(id)+'</span>':'')+'</div>'
    + '<div class="collapse-body"><pre class="json">'+escHtml(args)+'</pre></div>'
    + '</div>';
}

/* ── Tool result block ── */
function renderToolResult(content, toolId) {
  const preview = (content||'').slice(0, 100).replace(/\\n/g, ' ');
  const len = (content||'').length;
  return '<div class="msg toolResult">'
    + '<div class="msg-role toolResult collapsible" onclick="toggleCollapse(this)"><span class="tool-badge">📋 tool_result</span>'+(toolId?' <span class="tool-id">'+escHtml(toolId)+'</span>':'')+'<span class="msg-count">'+fmtTokens(len)+' chars</span></div>'
    + '<div class="collapse-body"><div class="msg-text">'+escHtml(content||'')+'</div></div>'
    + '<div class="msg-text" style="color:#484f58;font-size:11px;max-height:1.5em;overflow:hidden">'+escHtml(preview)+(len>100?'…':'')+'</div>'
    + '</div>';
}

function switchTab(el, contentId) {
  const parent = el.closest('.detail');
  parent.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  parent.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(contentId)?.classList.add('active');
}

/* ── WebSocket ── */
function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto+'//'+location.host+'/ws');

  ws.onopen = () => {
    document.getElementById('connDot').classList.add('connected');
    document.getElementById('connLabel').textContent = 'connected';
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onclose = () => {
    document.getElementById('connDot').classList.remove('connected');
    document.getElementById('connLabel').textContent = 'reconnecting...';
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'init' || msg.type === 'new') {
      document.getElementById('emptyState')?.remove();
      const el = createEntryEl(msg.entry);
      entryEls.set(msg.entry.id, el);
      const container = document.getElementById('entries');
      if (msg.type === 'new') {
        container.prepend(el);
        totalReqs++;
        if (msg.entry.usage) {
          totalTokens += msg.entry.usage.totalTokens || 0;
        }
        updateStats();
      } else {
        container.appendChild(el);
        totalReqs++;
        if (msg.entry.usage) totalTokens += msg.entry.usage.totalTokens || 0;
      }
    } else if (msg.type === 'update') {
      updateEntryEl(msg.entry);
      if (msg.entry.usage) {
        totalTokens += msg.entry.usage.totalTokens || 0;
      }
      updateStats();
    } else if (msg.type === 'detail') {
      renderDetail(msg.entry);
    } else if (msg.type === 'ready') {
      updateStats();
    }
  };
}

/* ── Enable/Disable ── */
async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const dot = document.getElementById('statusDot');
    const label = document.getElementById('statusLabel');
    if (data.enabled) {
      dot.className = 'status-dot on';
      label.textContent = 'intercepting ('+data.providers.length+' providers)';
      document.getElementById('btnEnable').disabled = true;
      document.getElementById('btnDisable').disabled = false;
    } else {
      dot.className = 'status-dot off';
      label.textContent = 'disabled';
      document.getElementById('btnEnable').disabled = false;
      document.getElementById('btnDisable').disabled = true;
    }
  } catch {
    document.getElementById('statusLabel').textContent = 'error';
  }
}

document.getElementById('btnEnable').onclick = async () => {
  document.getElementById('btnEnable').disabled = true;
  document.getElementById('statusLabel').textContent = 'enabling...';
  try {
    const res = await fetch('/api/enable', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) alert('Enable failed: ' + data.message);
  } catch(e) { alert('Error: '+e.message); }
  setTimeout(checkStatus, 1500);
};

document.getElementById('btnDisable').onclick = async () => {
  document.getElementById('btnDisable').disabled = true;
  document.getElementById('statusLabel').textContent = 'disabling...';
  try {
    const res = await fetch('/api/disable', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) alert('Disable failed: ' + data.message);
  } catch(e) { alert('Error: '+e.message); }
  setTimeout(checkStatus, 1500);
};

document.getElementById('btnClear').onclick = () => {
  document.getElementById('entries').innerHTML = '<div class="empty" id="emptyState"><h2>No requests yet</h2><p>Enable interception and send a message to your OpenClaw bot</p></div>';
  entryEls.clear();
  totalReqs = 0; totalTokens = 0; totalCost = 0;
  updateStats();
};

/* ── Init ── */
connect();
checkStatus();
setInterval(checkStatus, 10000);
</script>
</body>
</html>`;
}
