const $ = id => document.getElementById(id);
const make = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};

let cases = [];
let active, task, truth, run, trace;
let frameIndex = 0;
let stepIndex = 0;
let evidence = 'answer';
let caseRequest = 0;
let runRequest = 0;
const fetched = new Map();

function read(url) {
  if (!fetched.has(url)) {
    fetched.set(url, fetch(url).then(response => {
      if (!response.ok) throw new Error('Could not load ' + url);
      return response.json();
    }).catch(error => {
      fetched.delete(url);
      throw error;
    }));
  }
  return fetched.get(url);
}

function errorMessage(error) {
  $('error').textContent = error.message;
  $('error').hidden = false;
}

function pretty(element, value) {
  element.textContent = value === undefined ? 'No recorded value.' : JSON.stringify(value, null, 2);
  element.scrollTop = 0;
}

function svgElement(tag, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function frameTracks(record) {
  if (!record) return [];
  if (active.id === 'lineage') {
    return Object.entries(record.tracks || {}).map(([name, track]) => [name, track[frameIndex]]);
  }
  if (frameIndex === 4) return [['A', record.a_centers_t4]];
  if (frameIndex === 9) return ['A','B','C'].map(name => [name, record[name.toLowerCase()+'_centers_t9']]);
  return [];
}

function drawTrack(overlay, record, color, labelOffset, isTruth) {
  const root = active.id === 'lineage' ? $('root-filter').value : '';
  const r = active.frame_size[0] / 160;
  for (const [name, value] of frameTracks(record)) {
    if (root && root !== name) continue;
    if (!Array.isArray(value) || !value.length) continue;
    const points = Array.isArray(value[0]) ? value : [value];
    for (const point of points) {
      const [x, y] = point;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (isTruth) {
        overlay.append(svgElement('circle', {cx:x,cy:y,r,fill:'none',stroke:color,'stroke-width':r/3.2}));
      } else {
        const d = r * .72;
        overlay.append(svgElement('path', {d:'M'+(x-d)+' '+(y-d)+'l'+(2*d)+' '+(2*d)+'m'+(-2*d)+' 0l'+(2*d)+' '+(-2*d),stroke:color,'stroke-width':r/3.2}));
      }
      const text = svgElement('text', {x:x+r*1.2,y:y+labelOffset*r,fill:color,stroke:'#1d2029','stroke-width':r/4,'paint-order':'stroke','font-size':r*1.35,'font-weight':700});
      text.textContent = name;
      overlay.append(text);
    }
  }
}

function drawOverlay() {
  const overlay = $('overlay');
  overlay.replaceChildren();
  if ($('show-gt').checked) drawTrack(overlay, truth, '#39dfd0', -.7, true);
  if ($('show-answer').checked) drawTrack(overlay, trace?.answer, '#ffb4e1', 1.25, false);
}

function renderFrame(nextIndex) {
  frameIndex = Math.max(0, Math.min(active.frame_count - 1, nextIndex));
  const path = 'data/'+active.id+'/frames/'+String(frameIndex).padStart(4,'0')+'.webp';
  $('source-image').src = path;
  $('source-image').alt = active.source_name+' · '+active.frame_label+' '+frameIndex;
  $('frame-link').href = path;
  $('frame-index').value = frameIndex;
  $('frame-label').textContent = active.frame_label+' '+frameIndex+' / '+(active.frame_count-1);
  $('source-prev').disabled = frameIndex === 0;
  $('source-next').disabled = frameIndex === active.frame_count-1;
  $('input-note').textContent = active.id === 'mitosis'
    ? 'The grader checks positions at frames 4 and 9 and the first frame with two separate daughters.'
    : 'Frame preview uses original input coordinates. Prediction overlays are from the selected final submission.';
  drawOverlay();
}

function updateRunSelection() {
  for (const row of $('runs').rows) {
    const selected = row.dataset.run === run?.id;
    row.classList.toggle('selected', selected);
    row.querySelector('button').setAttribute('aria-pressed', String(selected));
  }
}

function renderRunRows() {
  const rows = active.runs.map(item => {
    const row = make('tr');
    row.dataset.run = item.id;
    const select = make('button', item.repeat ? 'Run '+item.repeat : 'Recorded run', 'run-select');
    select.type = 'button';
    select.setAttribute('aria-label', item.group+' · '+select.textContent);
    select.title = item.run_id;
    select.addEventListener('click', () => loadRun(item).catch(errorMessage));
    const runCell = make('td');
    runCell.append(select);
    const outcome = make('td');
    outcome.append(make('span',item.outcome,'outcome'+(item.outcome === 'Passed' ? ' passed' : '')));
    row.append(make('td',item.group),runCell,make('td',item.actions),make('td',item.specialist_calls),
      make('td',item.metrics[0][0]+' '+item.metrics[0][1]),outcome);
    return row;
  });
  $('runs').replaceChildren(...rows);
  updateRunSelection();
}

function toolName(event) {
  return event.tool || 'Invalid request';
}

function observation(url, label, caption) {
  const link = make('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const image = make('img');
  image.src = url;
  image.alt = label;
  image.loading = 'lazy';
  link.append(image);
  if (caption) link.append(make('span', caption));
  return link;
}

function renderStep(index) {
  stepIndex = index;
  const event = trace.events[index];
  $('step-title').textContent = 'Step '+event.step+' · '+toolName(event);
  $('step-count').textContent = trace.events.length+' events';
  $('step-note').textContent = [event.note, typeof event.tool_seconds === 'number' && event.tool_seconds > 0 ? event.tool_seconds.toFixed(2)+' s tool time' : ''].filter(Boolean).join(' · ');
  $('step-note').hidden = !$('step-note').textContent;
  $('prev-step').disabled = index === 0;
  $('next-step').disabled = index === trace.events.length - 1;
  Array.from($('steps').children).forEach((button, i) => button.setAttribute('aria-pressed', String(i===index)));
  const images = event.images.map((url, i) => observation(url, 'Recorded observation '+(i+1)+' for step '+event.step));
  $('step-images').replaceChildren(...images);
  const inputs = event.input_views.map(id => {
    const view = trace.input_view_index[id];
    const label = id+(Number.isInteger(view.frame) ? ' · Frame '+view.frame : '');
    return observation(view.url, label, label);
  });
  $('step-input-images').replaceChildren(...inputs);
  $('step-inputs').open = false;
  $('step-inputs').hidden = !inputs.length;
  $('input-summary').textContent = 'Recorded input views ('+inputs.length+')';
  pretty($('request-json'), {tool:event.tool, arguments:event.arguments});
  pretty($('response-json'), event.result);
  $('step-response').open = images.length === 0;
  $('step-request').open = false;
}

function renderEvidence() {
  for (const button of document.querySelectorAll('[data-evidence]')) {
    button.setAttribute('aria-pressed', String(button.dataset.evidence === evidence));
  }
  const entry = {answer:trace.answer,truth,evaluation:trace.evaluation}[evidence];
  pretty($('result-json'), entry);
}

async function loadRun(item) {
  const ticket = ++runRequest;
  run = item;
  trace = undefined;
  $('run-panel').hidden = $('result-panel').hidden = true;
  updateRunSelection();
  drawOverlay();
  const path = 'data/'+active.id+'/runs/'+item.id+'.json';
  const result = await read(path);
  if (ticket !== runRequest) return;
  trace = result;
  pretty($('task-schema'), {answer_schema:task.answer_schema, grading:task.grading ?? trace.evaluation.scope, seeds:task.seeds ?? task.series?.seed_centers_t0});
  $('trace-link').href = path;
  const steps = trace.events.map((event,index) => {
    const button = make('button',undefined,'step');
    button.type = 'button';
    const label = make('strong',toolName(event));
    if (event.result?.error) label.append(make('span','error','step-flag'));
    else if (event.images.length) label.append(make('span',event.images.length+' image'+(event.images.length===1?'':'s'),'step-flag'));
    button.append(make('span',String(event.step).padStart(2,'0'),'step-index'),label);
    button.addEventListener('click',() => renderStep(index));
    return button;
  });
  $('steps').replaceChildren(...steps);
  const metrics = [['Outcome',item.outcome],...item.metrics].map(([label,value]) => {
    const metric = make('div',undefined,'metric');
    metric.append(make('span',label),make('strong',value));
    return metric;
  });
  $('metrics').replaceChildren(...metrics);
  evidence = 'answer';
  renderEvidence();
  const specialist = trace.events.findIndex(event => ['deepsea_track','cellpose'].includes(event.tool) && !event.result?.error);
  renderStep(specialist >= 0 ? specialist : 0);
  $('run-panel').hidden = $('result-panel').hidden = false;
  $('steps').children[stepIndex]?.scrollIntoView({block:'nearest',container:'nearest'});
  drawOverlay();
}

async function loadCase() {
  const slug = location.hash.slice(1);
  if (slug === 'replay' && active) return;
  const requested = cases.find(item => item.id === slug) || cases[0];
  const ticket = ++caseRequest;
  if (slug && requested && slug !== requested.id) history.replaceState(null, '', '#'+requested.id);
  if (!requested || requested.id === active?.id) return;
  $('error').hidden = true;
  const base = 'data/'+requested.id+'/';
  const [definition, labels] = await Promise.all([read(base+'task.json'),read(base+'ground-truth.json')]);
  if (ticket !== caseRequest) return;
  ++runRequest;
  active = requested;
  task = definition;
  truth = labels;
  run = trace = undefined;
  document.querySelectorAll('.case-switch a').forEach(link => {
    if (link.hash === '#'+active.id) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  $('case-source').textContent = active.source_name;
  $('case-title').textContent = active.title;
  $('dataset-link').href = active.source_url;
  $('task-text').textContent = task.task;
  $('task-difficulty').textContent = active.difficulty;
  $('task-link').href = base+'task.json';
  $('gt-link').href = base+'ground-truth.json';
  $('task-schema').textContent = '';
  $('frame-index').max = active.frame_count-1;
  $('overlay').setAttribute('viewBox', '0 0 '+active.frame_size.join(' '));
  $('source-image').parentElement.style.aspectRatio = active.frame_size.join('/');
  $('source-image').parentElement.style.maxWidth = active.id === 'mitosis' ? '540px' : '820px';
  $('root-control').hidden = active.id !== 'lineage';
  const all = make('option','All roots');
  all.value = '';
  $('root-filter').replaceChildren(all,...Object.keys(truth.tracks || {}).map(name => make('option',name)));
  $('case-panel').hidden = $('replay').hidden = false;
  renderRunRows();
  renderFrame(active.first);
  const defaultRun = active.runs.find(item => item.specialist_calls > 0) || active.runs[0];
  await loadRun(defaultRun);
}

$('frame-index').addEventListener('input',event => renderFrame(Number(event.target.value)));
$('source-prev').addEventListener('click',() => renderFrame(frameIndex-1));
$('source-next').addEventListener('click',() => renderFrame(frameIndex+1));
for (const id of ['show-gt','show-answer','root-filter']) $(id).addEventListener('change',drawOverlay);
$('prev-step').addEventListener('click',() => renderStep(stepIndex-1));
$('next-step').addEventListener('click',() => renderStep(stepIndex+1));
document.querySelectorAll('[data-evidence]').forEach(button => button.addEventListener('click',() => {
  evidence = button.dataset.evidence;
  renderEvidence();
}));
$('jump-replay').addEventListener('click',event => {
  event.preventDefault();
  $('replay').scrollIntoView({block:'start'});
});
window.addEventListener('hashchange',() => loadCase().catch(errorMessage));
read('data/cases.json').then(items => {
  cases = items;
  return loadCase();
}).catch(errorMessage);
