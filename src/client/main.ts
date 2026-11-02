import './style.css';
import { createEventParser } from '../shared/sse.js';
import {
  TRANSPORTS,
  GUIDE,
  QUIZ,
  DEFAULT_PROMPT,
  type Event,
  type SessionCard,
  type Detail,
  type RunConfig,
  type RunReport,
} from '../shared/lesson.js';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => {
  $(id).textContent = value;
};
let liveAvailable = false,
  busy = false;
let controller: AbortController | undefined;
let selected: Detail | undefined;
let report: RunReport | undefined;
let trace: Event[] = [];
let runConfig: RunConfig | undefined;
let detailGeneration = 0;
let confirmId: string | undefined;
function notice(message = '') {
  text('notice', message);
  $('notice').hidden = !message;
}
async function api<T>(url: string, input?: unknown): Promise<T> {
  const response = await fetch(
    url,
    input === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
  );
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'The request failed.');
  return value;
}
const transport = () => $<HTMLSelectElement>('transport').value as RunConfig['transport'];
function controls() {
  for (const item of document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >(
    '#connections button,#connections input,#connections select,#connections textarea,#library button,#library input,#library textarea',
  ))
    item.disabled = busy;
  for (const id of ['new-session', 'delegate'])
    $(id).toggleAttribute('disabled', busy || !liveAvailable);
  $('resume').toggleAttribute(
    'disabled',
    busy || !liveAvailable || selected?.session.origin !== 'live',
  );
  $('stop').hidden = !busy;
  $<HTMLButtonElement>('stop').disabled = false;
  $('view-saved').toggleAttribute('disabled', busy || !report?.sessionId);
  $('export').toggleAttribute('disabled', busy || !trace.length);
}
async function task(work: () => Promise<void>) {
  if (busy) return;
  busy = true;
  controls();
  notice();
  try {
    await work();
  } catch (error) {
    notice((error as Error).message);
  } finally {
    busy = false;
    controls();
  }
}
function activate(id: string) {
  $<HTMLButtonElement>(`tab-${id}`).click();
}
function messageList(parent: HTMLElement, messages: Detail['messages']) {
  parent.replaceChildren();
  if (!messages.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No saved messages are available.';
    parent.append(p);
  }
  for (const message of messages) {
    const article = document.createElement('article');
    article.className = 'history-message';
    const role = document.createElement('small');
    role.textContent = message.type;
    const content = document.createElement('p');
    content.textContent = message.text;
    article.append(role, content);
    parent.append(article);
  }
}
function renderDetail(detail: Detail) {
  selected = detail;
  confirmId = undefined;
  $('delete-confirm').hidden = true;
  $('no-selection').hidden = true;
  $('selected-content').hidden = false;
  text(
    'session-origin',
    detail.session.origin === 'live' ? 'LIVE SDK SESSION' : 'RECORDED FIXTURE · NO MODEL RUN',
  );
  text('session-title', detail.session.title);
  text('session-tag', detail.session.tag || 'UNTAGGED');
  text('session-id', detail.session.id);
  text(
    'session-parent',
    detail.session.parentId
      ? `Forked from ${detail.session.parentId.slice(0, 8)}`
      : 'Original conversation',
  );
  $<HTMLInputElement>('rename-title').value = detail.session.title;
  $<HTMLInputElement>('tag-value').value = detail.session.tag || '';
  text(
    'resume-note',
    detail.session.origin === 'live'
      ? 'Resume continues this exact saved conversation using the selected transport. Model charges apply.'
      : 'This is a recorded fixture. History operations are real SDK calls; no model query created this conversation.',
  );
  messageList($('messages'), detail.messages);
  $('subagent-messages').replaceChildren();
  if (!detail.subagents.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent =
      'No saved specialist transcripts for this session. Discovery alone does not create them.';
    $('subagent-messages').append(p);
  }
  for (const agent of detail.subagents) {
    const section = document.createElement('details');
    section.className = 'specialist-history';
    const summary = document.createElement('summary');
    summary.textContent = `Agent ${agent.id} · ${agent.messages.length} saved messages`;
    const content = document.createElement('div');
    messageList(content, agent.messages);
    section.append(summary, content);
    $('subagent-messages').append(section);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-session]'))
    button.setAttribute('aria-pressed', String(button.dataset.session === detail.session.id));
  controls();
}
async function selectSession(id: string) {
  const generation = ++detailGeneration;
  const detail = await api<Detail>(`/api/session?id=${encodeURIComponent(id)}`);
  if (generation === detailGeneration) renderDetail(detail);
}
async function refreshLibrary(preferredId?: string) {
  const cards = await api<SessionCard[]>('/api/library');
  $('session-list').replaceChildren();
  if (!cards.length) {
    const p = document.createElement('p');
    p.className = 'empty-library';
    p.textContent = 'No workshop sessions yet. Load a recorded fixture or create a live session.';
    $('session-list').append(p);
  }
  for (const card of cards) {
    const button = document.createElement('button');
    button.className = 'session-card';
    button.dataset.session = card.id;
    button.setAttribute('aria-pressed', String(card.id === (preferredId || selected?.session.id)));
    const origin = document.createElement('small');
    origin.textContent = card.origin === 'live' ? 'LIVE SDK' : 'RECORDED FIXTURE';
    const title = document.createElement('strong');
    title.textContent = card.title;
    const meta = document.createElement('span');
    meta.textContent = `${card.id.slice(0, 8)}${card.parentId ? ' · fork' : ''}${card.tag ? ' · ' + card.tag : ''}`;
    button.append(origin, title, meta);
    button.addEventListener('click', () => {
      void task(() => selectSession(card.id));
    });
    $('session-list').append(button);
  }
  const id = preferredId || selected?.session.id;
  if (id && cards.some((c) => c.id === id)) await selectSession(id);
  else if (selected) {
    selected = undefined;
    $('selected-content').hidden = true;
    $('no-selection').hidden = false;
  }
  controls();
}
$('seed').addEventListener(
  'click',
  () =>
    void task(async () => {
      const detail = await api<Detail>('/api/seed', {});
      await refreshLibrary(detail.session.id);
    }),
);
$('refresh').addEventListener('click', () => void task(() => refreshLibrary()));
async function historyAction(
  action: 'rename' | 'tag' | 'fork' | 'delete',
  value?: string,
  id = selected?.session.id,
) {
  if (!id) return;
  const result = await api<Detail | null>('/api/command', {
    id,
    action,
    ...(value === undefined ? {} : { value }),
    ...(action === 'delete' ? { confirmId: id } : {}),
  });
  await refreshLibrary(result?.session.id);
}
$('rename').addEventListener(
  'click',
  () => void task(() => historyAction('rename', $<HTMLInputElement>('rename-title').value)),
);
$('tag').addEventListener(
  'click',
  () => void task(() => historyAction('tag', $<HTMLInputElement>('tag-value').value)),
);
$('fork').addEventListener(
  'click',
  () => void task(() => historyAction('fork', $<HTMLInputElement>('fork-title').value)),
);
$('delete').addEventListener('click', () => {
  if (!selected) return;
  confirmId = selected.session.id;
  text('delete-label', `Delete “${selected.session.title}” (${confirmId})?`);
  $('delete-confirm').hidden = false;
});
$('cancel-delete').addEventListener('click', () => {
  confirmId = undefined;
  $('delete-confirm').hidden = true;
});
$('confirm-delete').addEventListener('click', () => {
  const id = confirmId;
  if (id) void task(() => historyAction('delete', undefined, id));
});
for (const item of TRANSPORTS) {
  const card = document.createElement('article');
  card.className = 'transport-card';
  const tag = document.createElement('small');
  tag.textContent = item.tag;
  const name = document.createElement('h3');
  name.textContent = item.name;
  const detail = document.createElement('p');
  detail.textContent = item.description;
  card.append(tag, name, detail);
  $('transport-cards').append(card);
}
$('inspect').addEventListener(
  'click',
  () =>
    void task(async () => {
      text('connection-status', 'Inspecting');
      try {
        const result = await api<{
          transport: string;
          toolNames: string[];
          queryToolName: string;
          result: unknown;
        }>('/api/inspect', { transport: transport() });
        text('connection-status', 'Connected');
        text(
          'connection-summary',
          `${result.transport}: actual MCP initialize, tools/list, and tools/call completed. Query name: ${result.queryToolName}.`,
        );
        text('connection-result', JSON.stringify(result, null, 2));
        $('connection-result').hidden = false;
      } catch (error) {
        text('connection-status', 'Failed');
        throw error;
      }
    }),
);
function append(event: Event) {
  trace.push(event);
  if (trace.length > 100) trace.shift();
  const parent = $('events');
  if (parent.querySelector('.empty')) parent.replaceChildren();
  const article = document.createElement('article');
  article.className = `event ${event.kind === 'error' ? 'error' : event.kind === 'message' ? 'message' : event.kind === 'host' ? 'host' : 'control'}`;
  const title = document.createElement('b');
  title.textContent = event.title;
  const detail = document.createElement('p');
  detail.textContent = event.detail;
  article.append(title, detail);
  if (event.data !== undefined) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Selected fields';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(event.data, null, 2);
    details.append(summary, pre);
    article.append(details);
  }
  parent.append(article);
  while (parent.children.length > 100) parent.firstElementChild?.remove();
  parent.scrollTop = parent.scrollHeight;
}
async function workflow(config: RunConfig) {
  if (busy) return;
  busy = true;
  controller = new AbortController();
  report = undefined;
  trace = [];
  runConfig = config;
  $('events').replaceChildren();
  text('status', 'Running');
  text('result', 'Waiting for the live workflow…');
  text('run-meta', '');
  for (const id of ['tool-reads', 'agent-starts', 'agent-discovered']) text(id, '—');
  activate('connections');
  controls();
  notice();
  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Live workflow failed.');
    }
    if (!response.body) throw new Error('No event stream.');
    let finished = false;
    const parse = createEventParser((value) => {
      const event = value as Event;
      append(event);
      if (event.kind === 'result') {
        report = event.data as RunReport;
        text('result', report.text);
        text('tool-reads', String(report.toolReads));
        text('agent-starts', String(report.agentStarts));
        text('agent-discovered', String(report.agents.length));
        text(
          'run-meta',
          `Session ${report.sessionId.slice(0, 8)} · ${report.transport} · reported estimated cost $${report.costUsd.toFixed(4)}`,
        );
      }
      if (event.kind === 'error') text('result', event.detail);
      if (event.kind === 'done') {
        finished = true;
        text(
          'status',
          event.detail === 'success'
            ? 'Completed'
            : event.detail === 'cancelled'
              ? 'Cancelled'
              : 'Failed',
        );
      }
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      parse(decoder.decode(part.value, { stream: true }));
    }
    parse(decoder.decode());
    if (!finished) throw new Error('The connection ended without a final status.');
  } catch (error) {
    const cancelled = controller.signal.aborted;
    const detail = cancelled
      ? 'The live workflow was cancelled. Final execution counters are unknown.'
      : (error as Error).message;
    text('status', cancelled ? 'Cancelled' : 'Failed');
    text('result', detail);
    append({ kind: 'error', title: cancelled ? 'Cancelled' : 'Workflow failed', detail });
  } finally {
    controller = undefined;
    busy = false;
    await refreshLibrary((report as RunReport | undefined)?.sessionId).catch((error) =>
      notice(error.message),
    );
    controls();
  }
}
$('new-session').addEventListener(
  'click',
  () =>
    void workflow({
      action: 'new',
      transport: transport(),
      prompt: $<HTMLTextAreaElement>('prompt').value,
    }),
);
$('delegate').addEventListener(
  'click',
  () => void workflow({ action: 'delegate', transport: transport(), prompt: DEFAULT_PROMPT }),
);
$('resume').addEventListener('click', () => {
  if (selected?.session.origin === 'live')
    void workflow({
      action: 'resume',
      transport: transport(),
      sessionId: selected.session.id,
      prompt: $<HTMLTextAreaElement>('follow-up').value,
    });
});
$('stop').addEventListener('click', () => controller?.abort());
$('view-saved').addEventListener('click', () => {
  if (report) {
    activate('library');
    void task(() => selectSession(report!.sessionId));
  }
});
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ lesson: 6, config: runConfig, events: trace, report }, null, 2)], {
      type: 'application/json',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'lesson-06-workflow-trace.json';
  link.click();
  URL.revokeObjectURL(url);
});
for (const item of GUIDE) {
  const card = document.createElement('article');
  card.className = 'panel method-card';
  const group = document.createElement('small');
  group.textContent = item.group;
  const name = document.createElement('h3');
  name.textContent = item.name;
  const description = document.createElement('p');
  description.textContent = item.text;
  card.append(group, name, description);
  $('guide-cards').append(card);
}
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')];
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      $(item.getAttribute('aria-controls')!).hidden = !active;
    }
  });
  tab.addEventListener('keydown', (event) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      tabs[next]!.click();
      tabs[next]!.focus();
    }
  });
});
QUIZ.forEach((item, index) => {
  const field = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = `${index + 1}. ${item.question}`;
  field.append(legend);
  item.answers.forEach((answer, choice) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `q${index}`;
    input.value = String(choice);
    input.required = true;
    label.append(input, document.createTextNode(answer));
    field.append(label);
  });
  $('questions').append(field);
});
$('quiz-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData($<HTMLFormElement>('quiz-form'));
  const score = QUIZ.filter((item, index) => Number(data.get(`q${index}`)) === item.correct).length;
  text(
    'quiz-score',
    `${score} / ${QUIZ.length} correct${score === QUIZ.length ? ' · You understand the lifecycle.' : ' · Revisit the guide and try again.'}`,
  );
});
$<HTMLTextAreaElement>('prompt').value = DEFAULT_PROMPT;
void api<{ liveAvailable: boolean; model: string }>('/api/meta')
  .then((meta) => {
    liveAvailable = meta.liveAvailable;
    text('key-status', liveAvailable ? 'LIVE KEY CONFIGURED' : 'LOCAL ACTIVITIES READY');
    text(
      'live-note',
      liveAvailable
        ? `Live is available with ${meta.model}. Keys stay on the server; model charges apply.`
        : 'Set your own ANTHROPIC_API_KEY in the server .env file and restart for live workflows.',
    );
    controls();
  })
  .catch((error) => notice(error.message));
void refreshLibrary().catch((error) => notice(error.message));
window.addEventListener('pagehide', () => controller?.abort());
