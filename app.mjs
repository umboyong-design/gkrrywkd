import {kinds, labels, reportCount, validate, makePDF} from './forms.mjs';
import {activeDates, blockedRanges, calendarError, emptyCalendar, moveDate, purposes, relations} from './rules.mjs';
import {columns} from './roster-columns.mjs';

const $ = id => document.getElementById(id);
const editor = $('editor');
let mode = 'single';
let type = 'application';
let people = [];
let selected = 0;
let busy = false;
let previewTask;
let previewGeneration = 0;
let rosterNotice = '';
let rosterError = false;
let calendar = emptyCalendar;
let calendarSource = '저장소 기본 일정';
const selectedForBatch = new Set();

function koreaToday() {
  return new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format();
}
function newPerson() {
  return {
    identity: {grade:'1', classroom:'', number:'', name:''},
    application: {unit:'1일', days:'1', signed:koreaToday()},
    report: {unit:'1일', days:'1', signed:koreaToday(), proofs:[]}
  };
}
let individual = newPerson();
const person = () => mode === 'single' ? individual : people[selected];
function dataFor(entry, doc = type) {
  const data = {...entry.identity, ...entry[doc]};
  const dates = activeDates(data,calendar);
  data.days = String(dates.length);
  dates.slice(0,5).forEach((date,i) => {
    data['recordedDate'+(i+1)] = data['dayDate'+(i+1)];
    data['dayDate'+(i+1)] = date;
  });
  if (doc === 'application' && data.purposeChoice && data.purposeChoice !== '직접 입력')
    data.purpose = [data.purposeChoice,data.purpose].filter(Boolean).join(' — ');
  return data;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.flat().filter(child => child != null));
  return node;
}
const button = (title, handler, cls = 'secondary') =>
  el('button', {type:'button', className:cls, textContent:title, onclick:handler});
const hint = message => el('p', {className:'hint'}, message);

function group(title, children, note = '') {
  return el('section', {className:'group'}, el('h3', {}, title), note ? hint(note) : null,
    el('div', {className:'grid'}, children));
}
function field(target, key, label, opt = {}) {
  const {kind = 'text', options, wide, required = true, help, max = 75, min, step, limit, change, prefix = 'input'} = opt;
  const id = prefix + '-' + key;
  const input = el(options ? 'select' : kind === 'textarea' ? 'textarea' : 'input', {id, name:key});
  if (options) for (const item of options) input.add(el('option', {value:item}, item || '선택하세요'));
  if (input.tagName === 'INPUT') input.type = kind;
  if (['text','tel','textarea'].includes(kind) && !options) input.maxLength = max;
  if (kind === 'number') {
    if (min != null) input.min = min;
    if (limit != null) input.max = limit;
    if (step != null) input.step = step;
  }
  if (kind === 'textarea') input.rows = 4;
  if (kind === 'date' && key !== 'signed') { input.min = '2026-03-01'; input.max = '2027-02-28'; }
  input.autocomplete = 'off';
  input.required = required;
  if (required) input.setAttribute('aria-required', 'true');
  input.value = target[key] ?? '';
  input.addEventListener('input', () => {
    target[key] = input.value;
    input.removeAttribute('aria-invalid');
    if (mode === 'batch' && target === person()?.identity) refreshRosterLabel();
    if (key.startsWith('body')) {
      const i = Number(key.slice(4));
      const date = activeDates(dataFor(person()),calendar)[i-1];
      if (date) target['dayDate'+i] = date;
    }
    updateSummary();
  });
  if (mode === 'batch') input.addEventListener('change', () => {
    if (target === person()?.identity || ['unit','region','purposeChoice','guardianRel','leaderRel'].includes(key)) showRoster();
  });
  if (change) input.addEventListener('change', () => change(input.value));
  return el('label', {className:'field' + (wide ? ' full' : ''), htmlFor:id},
    el('span', {className:'field-label'}, label, required ? el('span', {className:'required', ariaHidden:'true'}, ' *') : null),
    input, help ? el('small', {}, help) : null);
}
function check(target, key, label) {
  const input = el('input', {type:'checkbox', id:'input-' + key, checked:!!target[key], required:true});
  input.onchange = () => {
    target[key] = input.checked; updateSummary();
    if (mode === 'batch' && ['attended','confirmed'].includes(key)) showRoster();
  };
  return el('label', {className:'check full'}, input, label);
}
function signature(doc, key, title) {
  const canvas = el('canvas', {width:500, height:250, ariaLabel:title + ' 입력란'});
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#102832';
  if (doc[key]) {
    const img = new Image();
    img.onload = () => { if (!drawing && !edited) ctx.drawImage(img, 0, 0); };
    img.src = doc[key];
  }
  let drawing = false;
  let edited = false;
  let pointer;
  const point = event => {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX-rect.left)*canvas.width/rect.width, (event.clientY-rect.top)*canvas.height/rect.height];
  };
  canvas.onpointerdown = event => {
    if (drawing || event.button !== 0) return;
    drawing = true;
    edited = true;
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    const [x,y] = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + .1, y);
    ctx.stroke();
  };
  canvas.onpointermove = event => {
    if (!drawing || pointer !== event.pointerId) return;
    ctx.lineTo(...point(event));
    ctx.stroke();
  };
  const finish = event => {
    if (!drawing || pointer !== event.pointerId) return;
    drawing = false;
    doc[key] = canvas.toDataURL('image/png');
    status.textContent = '서명 입력됨';
  };
  canvas.onpointerup = finish;
  canvas.onpointercancel = finish;
  const status = el('p', {className:'hint', role:'status'}, doc[key] ? '서명 입력됨' : '서명을 그려 주세요.');
  return el('details', {className:'signature'},
    el('summary', {}, title), canvas, status,
    button('이 서명 지우기', () => {
      if (busy) return;
      edited = true;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      delete doc[key];
      status.textContent = '서명을 지웠습니다.';
    }, 'quiet'));
}
function proofs(doc) {
  const input = el('input', {type:'file', id:'input-proofs', multiple:true, accept:'.jpg,.jpeg,.png,.pdf'});
  const list = el('div', {className:'file-list'});
  const status = el('p', {className:'hint', role:'status'});
  const refresh = () => {
    list.replaceChildren(...(doc.proofs ?? []).map((file, i) =>
      el('p', {}, file.name + ' ', button('삭제', () => { if (!busy) { doc.proofs.splice(i,1); refresh(); } }, 'quiet'))));
  };
  input.onchange = () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    const next = [...(doc.proofs ?? []), ...files];
    if (files.some(file => !/\.(png|jpe?g|pdf)$/i.test(file.name) || !file.size || file.size > 8 * 1024 * 1024)
      || next.length > 10 || next.reduce((size, file) => size + file.size, 0) > 25 * 1024 * 1024) {
      status.textContent = 'JPG·PNG·PDF를 최대 10개, 파일당 8MB, 합계 25MB까지 추가할 수 있습니다.';
      return;
    }
    doc.proofs = next;
    status.textContent = doc.proofs.length + '장 첨부됨';
    refresh();
  };
  refresh();
  return el('div', {className:'full'}, el('label', {className:'field', htmlFor:'proofs'},
    el('span', {className:'field-label'}, '활동 증빙 파일 *'), input,
    el('small', {}, '활동 장소와 동반인을 증명할 수 있는 JPG·PNG·PDF를 첨부하세요. 파일은 결과보고서 뒤에 붙습니다.')), status, list);
}
function updateSummary() {
  const display = $('schedule-summary');
  const entry = person();
  if (!display || !entry) return;
  const data = dataFor(entry);
  const dates = activeDates(data,calendar);
  const end = data.unit === '반일' ? data.start : data.end;
  const days = dates.length ? (data.unit === '반일' ? 0.5 : dates.length) : 0;
  const previous = data.previous === '' || data.previous == null ? NaN : Number(data.previous);
  const blocked = type === 'application' ? blockedRanges(data,calendar) : [];
  display.replaceChildren(
    el('p', {}, `출석인정 ${days}일` + (Number.isFinite(previous) ? ` · 누적 ${previous+days}일 · 잔여 ${20-previous-days}일` : '')),
    el('p', {}, `신청 마감 ${moveDate(data.start,-3) || '—'} · 보고서 마감 ${moveDate(end,3) || '—'}`),
    ...blocked.map(rule => el('p',{className:'roster-error'},`신청 불허 · ${rule.note} (${rule.start} ~ ${rule.end})`))
  );
}
function readCalendar(value) {
  if (!Array.isArray(value) || value.length > 200 || value.some(rule => !rule || calendarError(rule)))
    throw Error('일정 파일은 학년·유형·시작일·종료일·이름이 있는 일정 목록이어야 합니다.');
  return value.map(({grade,type,start,end,note})=>({grade,type,start,end,note}));
}
function renderCalendar(message = '') {
  const box = $('calendar-editor');
  const draft = {grade:'전체',type:'불허'};
  const status = el('p',{className:'hint',role:'status'},message);
  function apply(value) {
    calendar = value;
    calendarSource = '이 브라우저의 설정';
    try {
      localStorage.setItem('gyeongan-calendar-2026',JSON.stringify(calendar));
      renderCalendar('이 브라우저에 일정을 저장했습니다.');
    } catch { renderCalendar('일정을 이 탭에 적용했습니다. 유지하려면 일정 JSON을 내려받으세요.'); }
    renderEditor();
  }
  const upload = el('input',{type:'file',accept:'.json',id:'calendar-file'});
  upload.onchange = async () => {
    const file = upload.files[0];
    if (!file) return;
    try {
      if (file.size > 100000) throw Error('일정 파일은 100KB 이하여야 합니다.');
      const value = readCalendar(JSON.parse(await file.text()));
      if (!calendar.length || confirm('현재 학사일정 설정을 가져온 일정으로 교체할까요?')) apply(value);
    } catch (error) { status.textContent = error.message; }
    finally { upload.value = ''; }
  };
  const list = el('ul',{className:'calendar-list'},...calendar.map((rule,index) => el('li',{},
    `${rule.grade === '전체' ? '전체' : rule.grade+'학년'} · ${rule.type} · ${rule.note} · ${rule.start} ~ ${rule.end} `,
    button('삭제',() => apply(calendar.filter((_,i)=>i!==index)),'quiet'))));
  box.replaceChildren(hint(calendar.length ? `${calendarSource} · ${calendar.length}건` : '등록된 일정이 없습니다. 학교의 실제 불허기간과 휴업일을 확인하세요.'),
    list,
    field(draft,'grade','대상 학년',{options:['전체','1','2','3'],prefix:'calendar'}),
    field(draft,'type','기간 유형',{options:['불허','휴업'],prefix:'calendar'}),
    field(draft,'start','시작일',{kind:'date',prefix:'calendar'}),
    field(draft,'end','종료일',{kind:'date',prefix:'calendar'}),
    field(draft,'note','기간 이름',{max:60,prefix:'calendar'}),
    button('기간 추가',() => {
      const error = calendarError(draft);
      if (error || calendar.length >= 200) { status.textContent = error || '최대 200개까지 등록할 수 있습니다.'; return; }
      apply([...calendar,{...draft,note:draft.note.trim()}]);
    }),
    el('label',{className:'field',htmlFor:'calendar-file'},el('span',{className:'field-label'},'일정 JSON 가져오기'),upload),
    button('일정 JSON 내려받기',()=>downloadBytes(JSON.stringify(calendar,null,2),'calendar.json','application/json')),
    status);
}
async function loadCalendar() {
  try {
    const saved = localStorage.getItem('gyeongan-calendar-2026');
    if (saved !== null) {
      calendar = readCalendar(JSON.parse(saved));
      calendarSource = '이 브라우저의 설정';
      renderCalendar(); renderEditor(); return;
    }
  } catch { /* Load the repository calendar if the browser setting is unavailable. */ }
  try {
    const response = await fetch(new URL('./calendar.json',import.meta.url),{credentials:'omit'});
    if (!response.ok) throw Error();
    calendar = readCalendar(await response.json());
    renderCalendar(); renderEditor();
  } catch { renderCalendar('기본 일정 파일을 읽지 못했습니다. 실제 학사일정을 확인하세요.'); }
}
function renderEditor() {
  const entry = person();
  const app = type === 'application';
  $('editor-title').textContent = mode === 'batch' && entry
    ? (entry.identity.name || '선택한 학생') + ' · 문서 작성' : '작성할 서식';
  $('empty-editor').hidden = !!entry;
  $('editor-actions').hidden = !entry;
  editor.hidden = !entry;
  $('application').setAttribute('aria-pressed', app);
  $('report').setAttribute('aria-pressed', !app);
  if (!entry) { editor.replaceChildren(); return; }
  const id = entry.identity;
  const doc = entry[type];
  const f = (key, label, opt) => field(doc,key,label,opt);
  const half = doc.unit === '반일';
  const reportDays = el('div');
  const refreshDays = () => {
    const data = dataFor(entry);
    const dates = activeDates(data,calendar);
    const count = dates.length ? reportCount(data) : 0;
    reportDays.replaceChildren(group('체험일별 기록', Array.from({length:count}, (_, index) => {
      const i = index + 1;
      const children = [];
      children.push(f('body'+i, '활동 내용과 느낀 점', {kind:'textarea', max:1600}));
      return el('div', {className:'day-entry full'}, el('h4', {}, i+'일차 · '+dates[index]+(i>1?' · 별지':'')), children);
    }).concat(proofs(doc)), dates.length ? '학생이 한 일과 배운 점을 체험일마다 직접 적어 주세요.' : '체험 일정을 먼저 입력하세요.'));
  };
  const typeExtras = el('div', {className:'full'});
  const purposeSelect = el('div',{className:'full'});
  const refreshKind = () => {
    const options = purposes[doc.kind] ?? [];
    purposeSelect.replaceChildren(f('purposeChoice','세부 목적',{options:['',...new Set([...options,...(doc.purposeChoice?[doc.purposeChoice]:[])])],required:false}));
    typeExtras.replaceChildren(...(doc.kind === '가정학습'
      ? [check(doc, 'severe', '감염병 위기경보 심각 단계임을 확인했습니다.')] : []));
  };
  refreshKind();
  const sections = [
    group('학생 정보', [
      field(id,'name','성명',{max:20}),
      field(id,'grade','학년',{options:['','1','2','3'],change:app?null:refreshDays}),
      field(id,'classroom','반',{kind:'number',min:1,limit:99,step:1}),
      field(id,'number','번호',{kind:'number',min:1,limit:99,step:1}),
      app ? f('studentPhone','학생 휴대폰',{kind:'tel',max:22,wide:true}) : null
    ]),
    group('체험 일정', [
      f('unit','체험 단위',{options:['1일','반일'],change:renderEditor,wide:true}),
      f('start',half?'체험일':'시작일',{kind:'date',change:app?null:refreshDays,wide:half}),
      !half ? f('end','종료일',{kind:'date',change:app?null:refreshDays}) : null,
      half ? f('from','시작 시각',{kind:'time'}) : null,
      half ? f('to','종료 시각',{kind:'time'}) : null,
      app ? f('previous','이번 신청 전 사용 일수',{kind:'number',min:0,limit:20,step:.5,help:'이번 신청을 포함한 누적 일수는 PDF에 자동 반영됩니다.'}) : null,
      half ? check(doc,'attended','체험 당일 수업에 참여하는 경우입니다.') : null,
      f('kind','학습 형태',{options:['',...kinds],change:() => { doc.purposeChoice = ''; refreshKind(); if (mode === 'batch') showRoster(); }}),
      app ? purposeSelect : null,
      f('region','국내·국외',{options:['','국내','국외'],required:false,change:renderEditor}),
      f('destination','목적지',{max:65}),
      typeExtras,
      el('div',{id:'schedule-summary',className:'schedule-summary full',role:'status'}),
      app ? f('lodging','숙박장소',{required:false,max:45,help:'숙박하는 경우에 입력하세요.'}) : null,
      app ? check(doc,'confirmed','학교 세부 규정과 실제 학사일정의 불허기간을 확인했습니다.') : null
    ])
  ];
  if (app) sections.push(
    group('보호자·인솔자 정보', [
      f('guardian','보호자 성명',{max:20}),f('guardianRel','보호자 관계',{options:['',...new Set([...relations,...(doc.guardianRel?[doc.guardianRel]:[])])]}),f('guardianPhone','보호자 휴대폰',{kind:'tel',max:22}),
      el('div', {},button('보호자 정보로 인솔자 채우기', () => {
        doc.leader = doc.guardian; doc.leaderRel = doc.guardianRel; doc.leaderPhone = doc.guardianPhone;
        renderEditor(); $('input-leader')?.focus();
      })),
      f('leader','인솔자 성명',{max:20}),f('leaderRel','인솔자 관계',{options:['',...new Set([...relations,...(doc.leaderRel?[doc.leaderRel]:[])])]}),f('leaderPhone','인솔자 휴대폰',{kind:'tel',max:22})
    ]),
    group('체험학습 계획', [
      f('purpose','목적 상세',{kind:'textarea',wide:true,max:350,required:false,help:'세부 목적을 선택하거나 직접 입력하세요.'}),
      f('plan','체험학습 계획',{kind:'textarea',wide:true,max:1500,help:'날짜별 장소와 활동을 적어 주세요.'})
    ])
  );
  else {
    sections.push(group('결과보고서 정보',[
      button('신청서의 일정과 동반자 불러오기', () => {
        for (const key of ['unit','start','end','from','to','attended','kind','region','destination','guardian','severe']) {
          if (entry.application[key] != null) doc[key] = entry.application[key];
        }
        renderEditor();
      }),
      f('guardian','보호자(동반자) 성명',{max:20}),
      f('title','보고서 제목',{max:65}),
      doc.region === '국외' ? check(doc,'overseasProof','날짜 확인이 가능한 증빙 사본을 첨부했습니다.') : null
    ]), reportDays);
    refreshDays();
  }
  sections.push(group('작성일과 서명', [
    f('signed','작성일',{kind:'date',wide:true}),
    signature(doc,'guardianSignature','보호자 서명'),
    signature(doc,'studentSignature','학생 서명')
  ], '서명은 해당자가 직접 그리거나 출력 후 서명할 수 있습니다.'));
  editor.replaceChildren(...sections);
  updateSummary();
}

const identityKeys = ['grade','classroom','number','name'];
const commonKeys = ['unit','start','end','from','to','kind','purposeChoice','region','destination','lodging','attended','severe','plan','purpose'];
const importLabel = 'CSV·엑셀 명단 불러오기';
const normalized = str => String(str).toLowerCase().replace(/[\s_\uFEFF()·.–-]/g, '');
const spreadsheet = () => globalThis.XLSX;

function downloadBytes(bytes, filename, mime) {
  const url = URL.createObjectURL(new Blob([bytes], {type:mime}));
  const link = el('a', {href:url, download:filename});
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}
function writeRosterTemplate() {
  const headers = columns.map(([name]) => name);
  downloadBytes('\uFEFF'+headers.join(',')+'\r\n', '교외체험학습_학급명단.csv','text/csv;charset=utf-8');
}
function studentLabel(entry, i) {
  const {grade,classroom,number,name} = entry.identity;
  return [grade && grade+'학년', classroom && classroom+'반', number && number+'번', name].filter(Boolean).join(' ') || (i+1)+'번째 학생';
}
function refreshRosterLabel() {
  const item = $('roster-list')?.querySelector('[aria-pressed=true]');
  const entry = person();
  if (!entry) return;
  if (item) item.textContent = studentLabel(entry, selected);
  $('editor-title').textContent = (entry.identity.name || '선택한 학생') + ' · 문서 작성';
}
function feedback(messages = [], error = false, focus = false) {
  const target = $('feedback');
  target.hidden = !messages.length;
  target.classList.toggle('error', error);
  target.replaceChildren(messages.length <= 1
    ? el('p', {}, messages[0] ?? '')
    : el('ul', {}, messages.map(message => el('li', {}, message))));
  if (focus) target.focus();
}
function showRoster() {
  const container = $('roster');
  container.hidden = mode !== 'batch';
  if (container.hidden) { container.replaceChildren(); return; }
  const upload = el('input',{id:'roster-file',type:'file',accept:'.csv,.xlsx,.xls'});
  upload.onchange = () => {
    const file = upload.files[0];
    if (file) runBusy(() => importRoster(file), true);
  };
  const add = button('학생 추가', () => {
    if (people.length >= 30) { rosterMessage('한 번에 최대 30명까지 등록할 수 있습니다.',true); return; }
    const entry = newPerson(); people.push(entry); selectedForBatch.add(entry); selected = people.length-1;
    showRoster(); renderEditor(); feedback(); $('input-name')?.focus();
  });
  const remove = button('선택 학생 삭제', () => {
    if (!person() || !confirm('선택한 학생의 입력 내용을 삭제할까요?')) return;
    selectedForBatch.delete(person());
    people.splice(selected,1); selected = Math.max(0,Math.min(selected,people.length-1));
    rosterMessage('선택한 학생을 삭제했습니다.'); renderEditor(); feedback();
  }, 'quiet');
  const list = el('div',{id:'roster-list',className:'roster-list'},
    people.map((entry, i) => {
      const item = button(studentLabel(entry,i), () => {
        selected = i; showRoster(); renderEditor(); feedback();
        $('roster-list')?.children[i]?.focus();
      });
      item.setAttribute('aria-pressed', i === selected);
      return item;
    }));
  container.replaceChildren(el('h2',{},'학급 명단 · '+people.length+' / 30명'), hint('첫 행에 학년, 반, 번호, 성명을 넣으세요. 서식의 나머지 열은 선택 항목입니다. 명단 불러오기는 기존 학급 명단을 교체합니다.'),
    el('div',{className:'roster-tools'}, el('label',{className:'field',htmlFor:upload.id},
      el('span',{className:'field-label'},importLabel), upload),
      button('CSV 양식',writeRosterTemplate), el('a',{className:'secondary template-link',href:'assets/roster-template.xlsx',download:'교외체험학습_30명_입력양식.xlsx'},'엑셀 양식'), add),
    el('p',{className:'hint' + (rosterError?' roster-error':''),role:'status'},rosterNotice),
    people.length ? list : null,
    people.length ? rosterGrid() : null,
    people.length ? el('div',{className:'actions batch-actions'},
      button('선택 학생의 공통 내용 복사', copyCommon),
      button('현재 서식 ZIP',()=>runBusy(()=>batchDownload([type]))),
      button('두 서식 ZIP',()=>runBusy(()=>batchDownload(['application','report'])),'primary'), remove) : null);
}
function rosterGrid() {
  const fields = [
    ['단위','unit',['1일','반일']],['학습 형태','kind',kinds],
    ['세부 목적','purposeChoice',[]],['국내·국외','region',['국내','국외']],
    ['당일 수업','attended',['예','아니오']],['규정 확인','confirmed',['예','아니오']],
    ['보호자 관계','guardianRel',relations],['인솔자 관계','leaderRel',relations]
  ].filter(([label,key]) => type === 'application' || !['purposeChoice','confirmed','guardianRel','leaderRel'].includes(key));
  const table = el('table',{className:'roster-grid'}, el('thead',{},el('tr',{},
    ...['대상','학생',...fields.map(([label])=>label)].map(label=>el('th',{scope:'col'},label)))));
  const body = el('tbody');
  for (const [i,entry] of people.entries()) {
    const doc = entry[type];
    const label = studentLabel(entry,i);
    const pick = el('input',{type:'checkbox',checked:selectedForBatch.has(entry),ariaLabel:label+' 일괄 작업 대상'});
    pick.onchange = () => pick.checked ? selectedForBatch.add(entry) : selectedForBatch.delete(entry);
    const choices = new Map();
    for (const [title,key,options] of fields) {
      const input = el('select',{ariaLabel:label+' '+title});
      const boolean = ['confirmed','attended'].includes(key);
      const refresh = (values) => {
        const value = boolean ? ({true:'예',false:'아니오'}[doc[key]] ?? '') : (doc[key] ?? '');
        input.replaceChildren(...['',...new Set([...values,...(value?[value]:[])])].map(item=>el('option',{value:item},item || '선택')));
        input.value = value;
        input.disabled = key === 'purposeChoice' && !values.length;
      };
      refresh(key === 'purposeChoice' ? (purposes[doc.kind] ?? []) : options);
      input.onchange = () => {
        doc[key] = boolean ? input.value === '예' : input.value;
        if (key === 'kind' && choices.has('purposeChoice')) {
          doc.purposeChoice = '';
          choices.get('purposeChoice').refresh(purposes[doc.kind] ?? []);
        }
        if (person() === entry) renderEditor();
      };
      choices.set(key,{input,refresh});
    }
    body.append(el('tr',{},el('td',{},pick),el('th',{scope:'row'},label),...[...choices.values()].map(({input})=>el('td',{},input))));
  }
  table.append(body);
  const toggle = el('input',{type:'checkbox',checked:people.every(entry=>selectedForBatch.has(entry))});
  toggle.onchange = () => {
    selectedForBatch.clear();
    if (toggle.checked) people.forEach(entry=>selectedForBatch.add(entry));
    showRoster();
  };
  return el('details',{className:'batch-grid',open:true},el('summary',{},'표에서 선택 항목 편집'),
    el('label',{className:'check'},toggle,'일괄 작업 대상 전체 선택'),
    el('div',{className:'table-scroll',tabIndex:0,ariaLabel:'학급 편집표. 가로로 스크롤할 수 있습니다.'},table));
}
function rosterMessage(message, error = false) {
  rosterNotice = message;
  rosterError = error;
  showRoster();
}
function cellText(value,key) {
  if (value == null) return '';
  if (typeof value === 'number' && (['start','end','signed'].includes(key) || key.startsWith('dayDate'))) {
    const date = spreadsheet().SSF.parse_date_code(value);
    if (date) return date.y+'-'+String(date.m).padStart(2,'0')+'-'+String(date.d).padStart(2,'0');
  }
  if (typeof value === 'number' && (key === 'from' || key === 'to')) {
    const minutes = Math.round(value*1440);
    return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
  }
  let result = String(value).trim();
  if (['start','end','signed'].includes(key) || key.startsWith('dayDate')) {
    const match = /^(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})\.?$/.exec(result);
    if (match) result = match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');
  }
  if (['from','to'].includes(key) && /^\d:\d\d$/.test(result)) result = '0'+result;
  if (/Phone$/.test(key) && typeof value === 'number' && /^\d{9,10}$/.test(result) && !result.startsWith('0')) result = '0'+result;
  if (['confirmed','attended','severe'].includes(key)) return /^(1|true|y|예|확인|참여|동의)$/i.test(result);
  if (key === 'unit' && ['1일 기준','종일','전일'].includes(result)) return '1일';
  if (key === 'unit' && result === '반일 기준') return '반일';
  if (key === 'kind' && result === '가족여행') return '가족동반여행';
  if (key === 'kind' && result === '친척집 방문') return '친·인척 방문';
  return result;
}
async function importRoster(file) {
  if (file.size > 2 * 1024 * 1024) throw Error('명단 파일은 2MB 이하로 저장해 주세요.');
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw Error('CSV, XLSX 또는 XLS 파일을 선택해 주세요.');
  const bytes = await file.arrayBuffer();
  const xlsx = spreadsheet();
  let book;
  if (/\.csv$/i.test(file.name)) {
    let csv;
    try { csv = new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
    catch { csv = new TextDecoder('euc-kr').decode(bytes); }
    book = xlsx.read(csv,{type:'string',raw:true,sheetRows:33});
  } else book = xlsx.read(bytes,{type:'array',sheetRows:33});
  const sheet = book.Sheets[book.SheetNames[0]];
  const matrix = sheet ? xlsx.utils.sheet_to_json(sheet,{header:1,defval:'',blankrows:false}) : [];
  if (!matrix.length) throw Error('명단 파일의 첫 번째 시트가 비어 있습니다.');
  const [headers,...rawRows] = matrix;
  const aliases = new Map([['이름','성명'],['이름성명','성명'],['학생명','성명'],['학생이름','성명'],['학급','반'],['번','번호'],['보호자명','보호자']]);
  const names = headers.map(value => aliases.get(normalized(value)) ?? normalized(value));
  const legacyDates = Array.from({length:5},(_,i) => [i+1+'일차날짜','dayDate'+(i+1),'report']);
  const fields = [...columns,...legacyDates].map(([header,key,doc])=>[names.indexOf(normalized(header)),key,doc]);
  if (fields.slice(0,4).some(([i])=>i===-1)) throw Error('첫 행의 필수 열인 학년, 반, 번호, 성명을 확인해 주세요.');
  const rows = rawRows.filter(row => fields.some(([index]) => index >= 0 && String(row[index] ?? '').trim()));
  if (headers.length > 100 || rows.length > 30 || (sheet['!fullref'] && xlsx.utils.decode_range(sheet['!fullref']).e.r > 32))
    throw Error('한 번에 학생 30명까지 불러올 수 있습니다.');
  if (!rows.length) throw Error('머리글 아래에 학생 정보를 넣어 주세요.');
  const used = new Set();
  const imported = rows.map((row,i)=>{
    const entry = newPerson();
    for (const [index,key,doc] of fields) {
      if (index < 0 || row[index] == null || row[index] === '') continue;
      const value = cellText(row[index],key);
      if (!doc) entry.identity[key] = value;
      else if (doc === 'both') { entry.application[key] = value; entry.report[key] = value; }
      else entry[doc][key] = value;
    }
    const {grade,classroom,number,name} = entry.identity;
    if (!name || !/^[1-3]$/.test(grade) || ![classroom,number].every(v=>/^\d{1,2}$/.test(v) && Number(v)>0))
      throw Error((i+1)+'번째 학생의 학년, 반, 번호, 성명을 확인해 주세요.');
    const key = [grade,classroom,number].map(Number).join('-');
    if (used.has(key)) throw Error((i+1)+'번째 학생의 학년·반·번호가 중복됩니다.');
    used.add(key);
    return entry;
  });
  if (people.length && !confirm('현재 명단과 학생별 입력을 새 명단으로 교체할까요?')) { showRoster(); return; }
  people = imported; selected = 0;
  selectedForBatch.clear();
  people.forEach(entry=>selectedForBatch.add(entry));
  rosterMessage(imported.length+'명을 불러왔습니다.');
  renderEditor(); feedback();
}
function copyCommon() {
  const source = person()?.[type];
  const recipients = people.filter(entry=>entry !== person() && selectedForBatch.has(entry));
  if (!source || !recipients.length) { rosterMessage('원본 학생을 제외하고 표에서 복사할 대상을 선택해 주세요.',true); return; }
  if (!confirm('현재 서식의 일정·목적지와 공통 계획을 선택한 '+recipients.length+'명에게 복사할까요?')) return;
  for (const entry of recipients) {
    for (const key of commonKeys) if (source[key] != null && source[key] !== '') entry[type][key] = source[key];
    if (!purposes[entry[type].kind]?.includes(entry[type].purposeChoice)) entry[type].purposeChoice = '';
  }
  rosterMessage(recipients.length+'명에게 공통 내용을 복사했습니다.');
}

function fileName(entry, doc) {
  const {grade,classroom,number,name} = entry.identity;
  const safe = value => String(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,30);
  return [grade+'학년',classroom+'반',number+'번',name,labels[doc]].map(safe).join('_')+'.pdf';
}
function assess(entry, doc) {
  const data = dataFor(entry, doc);
  const result = validate(data,doc,calendar);
  if (!['1일','반일'].includes(data.unit)) result.errors.unit = '신청 단위는 1일 또는 반일로 입력해 주세요.';
  return {data,...result};
}
async function runBusy(action, roster = false) {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll('button:not(#close-preview):not(#print-preview),input,select,textarea')].filter(control=>!control.disabled);
  controls.forEach(control=>{control.disabled = true;});
  try { await action(); }
  catch (error) {
    const message = error?.message || '요청을 처리하지 못했습니다.';
    if (roster) rosterMessage(message,true);
    else feedback([message],true,true);
  } finally {
    controls.forEach(control=>{control.disabled=false;});
    busy = false;
  }
}
async function renderPreview(pdfBytes, title) {
  $('print-preview').disabled = true;
  const generation = ++previewGeneration;
  const dialog = $('preview-dialog');
  const pages = $('preview-pages');
  const status = $('preview-status');
  $('preview-title').textContent = title+' 미리보기';
  pages.replaceChildren();
  status.textContent = '페이지를 불러오는 중입니다.';
  dialog.showModal();
  try {
    const pdfjs = await import('./assets/pdf.mjs');
    if (generation !== previewGeneration) return;
    pdfjs.GlobalWorkerOptions.workerSrc = './assets/pdf.worker.mjs';
    previewTask = pdfjs.getDocument({data:pdfBytes,isEvalSupported:false,disableFontFace:false});
    const preview = await previewTask.promise;
    for (let i=1;i<=preview.numPages;i++) {
      if (generation !== previewGeneration) return;
      const page = await preview.getPage(i);
      const viewport = page.getViewport({scale:1.4});
      const canvas = el('canvas',{width:Math.ceil(viewport.width),height:Math.ceil(viewport.height),role:'img',ariaLabel:i+'쪽'});
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      if (generation !== previewGeneration) return;
      pages.append(canvas);
    }
    status.textContent = preview.numPages+'쪽';
    $('print-preview').disabled = false;
  } catch {
    if (generation === previewGeneration) status.textContent = '이 브라우저에서 미리보기를 표시하지 못했습니다. PDF를 내려받아 열어 주세요.';
  }
}
async function singleAction(preview) {
  const entry = person();
  if (!entry) return;
  const {data,errors,warnings} = assess(entry,type);
  editor.querySelectorAll('[aria-invalid]').forEach(item=>item.removeAttribute('aria-invalid'));
  if (Object.keys(errors).length) {
    for (const key of Object.keys(errors)) $('input-'+key)?.setAttribute('aria-invalid','true');
    feedback(Object.values(errors),true,true);
    return;
  }
  feedback(['PDF 만드는 중…']);
  const bytes = await makePDF(data,type);
  feedback(warnings);
  if (preview) await renderPreview(bytes,labels[type]);
  else downloadBytes(bytes,fileName(entry,type),'application/pdf');
}
async function batchDownload(types) {
  const jobs = [];
  const issues = [];
  const seen = new Set();
  for (const [i,entry] of people.entries()) {
    if (!selectedForBatch.has(entry)) continue;
    const name = studentLabel(entry,i);
    const key = [entry.identity.grade,entry.identity.classroom,entry.identity.number].map(Number).join('-');
    if (seen.has(key)) issues.push(name+' · 학년·반·번호가 중복됩니다.');
    seen.add(key);
    for (const doc of types) {
      const {data,errors,warnings} = assess(entry,doc);
      const messages = Object.values(errors);
      if (messages.length) issues.push(name+' · '+labels[doc]+' — '+messages.join(' '));
      jobs.push({entry,doc,data,warnings,name});
    }
  }
  if (!jobs.length) { feedback(['표에서 일괄 작업 대상을 선택해 주세요.'],true,true); return; }
  if (issues.length) { feedback(['아래 항목을 수정한 후 다시 내려받아 주세요.',...issues],true,true); return; }
  const zip = new globalThis.JSZip();
  const notes = [];
  const names = new Set();
  for (const [index,job] of jobs.entries()) {
    feedback(['문서 만드는 중 · '+(index+1)+' / '+jobs.length]);
    const {entry,doc,data,warnings,name} = job;
    try {
      const basename = fileName(entry,doc);
      if (names.has(basename)) throw Error('파일 이름이 중복됩니다. 학생 정보를 확인해 주세요.');
      names.add(basename);
      zip.file(basename,await makePDF(data,doc));
      if (warnings.length) notes.push(name+' · '+labels[doc]+' — '+warnings.join(' '));
    } catch(error) {
      issues.push(name+' · '+labels[doc]+' — '+error.message);
    }
    await new Promise(resolve => setTimeout(resolve,0));
  }
  if (issues.length) { feedback(['아래 항목을 수정한 후 다시 내려받아 주세요.',...issues],true,true); return; }
  feedback(['ZIP 만드는 중…']);
  const bytes = await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
  downloadBytes(bytes,'경안고_교외체험학습_'+(types.length===1?labels[types[0]]:'신청서_결과보고서')+'_'+jobs.length/types.length+'명.zip','application/zip');
  feedback([jobs.length+'건을 ZIP으로 만들었습니다.',...notes]);
}
for (const value of ['single','batch']) {
  $(value).onclick = () => {
    mode = value;
    for (const key of ['single','batch']) $(key).setAttribute('aria-pressed', key === mode);
    showRoster(); renderEditor(); feedback();
  };
}
for (const value of ['application','report']) {
  $(value).onclick = () => {
    type = value; showRoster(); renderEditor(); feedback();
  };
}
$('preview').onclick = () => runBusy(()=>singleAction(true));
$('download').onclick = () => runBusy(()=>singleAction(false));
$('close-preview').onclick = () => $('preview-dialog').close();
$('print-preview').onclick = () => window.print();
$('preview-dialog').addEventListener('close', () => {
  previewGeneration++;
  previewTask?.destroy().catch(()=>{});
  previewTask = undefined;
  $('preview-pages').replaceChildren();
});
$('reset').onclick = () => {
  if (!confirm('이 탭의 학생·학부모 입력과 교사용 학급 명단을 모두 지울까요?')) return;
  individual = newPerson(); people = []; selected = 0; rosterNotice = ''; rosterError = false;
  selectedForBatch.clear();
  showRoster(); renderEditor(); feedback(['입력한 내용을 지웠습니다.']);
};
editor.addEventListener('submit',event=>event.preventDefault());
renderEditor();
loadCalendar();


