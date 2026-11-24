import {kinds, labels, reportCount, validate, makePDF} from './forms.mjs';

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
const dataFor = (entry, doc = type) => ({...entry.identity, ...entry[doc]});

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
  const {kind = 'text', options, wide, required = true, help, max = 75, min, step, limit, change} = opt;
  const id = 'input-' + key;
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
  });
  if (change) input.addEventListener('change', () => change(input.value));
  return el('label', {className:'field' + (wide ? ' full' : ''), htmlFor:id},
    el('span', {className:'field-label'}, label, required ? el('span', {className:'required', ariaHidden:'true'}, ' *') : null),
    input, help ? el('small', {}, help) : null);
}
function check(target, key, label) {
  const input = el('input', {type:'checkbox', id:'input-' + key, checked:!!target[key], required:true});
  input.onchange = () => { target[key] = input.checked; };
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
  const input = el('input', {type:'file', id:'proofs', multiple:true, accept:'image/jpeg,image/png,.jpg,.jpeg,.png'});
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
    if (files.some(file => !/\.(png|jpe?g)$/i.test(file.name) || !file.size || file.size > 8 * 1024 * 1024)
      || next.length > 10 || next.reduce((size, file) => size + file.size, 0) > 25 * 1024 * 1024) {
      status.textContent = 'JPG·PNG만 추가할 수 있습니다. 최대 10장, 파일당 8MB, 합계 25MB까지 가능합니다.';
      return;
    }
    doc.proofs = next;
    status.textContent = doc.proofs.length + '장 첨부됨';
    refresh();
  };
  refresh();
  return el('div', {className:'full'}, el('label', {className:'field', htmlFor:'proofs'},
    el('span', {className:'field-label'}, '증빙 사진'), input,
    el('small', {}, '활동 장소와 동반인을 증명할 수 있는 사진 등을 첨부하세요. JPG·PNG는 결과보고서 뒤에 붙고, 다른 형식은 제출할 때 별도로 첨부합니다.')), status, list);
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
    const count = reportCount(doc);
    reportDays.replaceChildren(group('체험일별 기록', Array.from({length:count}, (_, index) => {
      const i = index + 1;
      const children = [];
      if (count > 1 || (doc.unit !== '반일' && doc.end && doc.end !== doc.start))
        children.push(f('dayDate'+i, '체험일', {kind:'date'}));
      children.push(f('body'+i, '활동 내용과 느낀 점', {kind:'textarea', max:1600}));
      return el('div', {className:'day-entry full'}, el('h4', {}, i+'일차'+(i>1?' · 별지':'')), children);
    }).concat(proofs(doc)), '학생이 한 일과 배운 점을 체험일마다 직접 적어 주세요.'));
  };
  const typeExtras = el('div', {className:'full'});
  const refreshKind = () => {
    typeExtras.replaceChildren(...(doc.kind === '가정학습'
      ? [check(doc, 'severe', '감염병 위기경보 심각 단계임을 확인했습니다.')] : []));
  };
  refreshKind();
  const sections = [
    group('학생 정보', [
      field(id,'name','성명',{max:20}),
      field(id,'grade','학년',{options:['','1','2','3']}),
      field(id,'classroom','반',{kind:'number',min:1,limit:99,step:1}),
      field(id,'number','번호',{kind:'number',min:1,limit:99,step:1}),
      app ? f('studentPhone','학생 휴대폰',{kind:'tel',max:22,wide:true}) : null
    ]),
    group('체험 일정', [
      f('unit','체험 단위',{options:['1일','반일'],change:renderEditor,wide:true}),
      f('start',half?'체험일':'시작일',{kind:'date',change:app?null:refreshDays,wide:half}),
      !half ? f('end','종료일',{kind:'date',change:app?null:refreshDays}) : null,
      half ? f('from','시작 시각',{kind:'time'}) : f('days','출석인정 일수',{kind:'number',min:1,limit:5,step:1,change:app?null:refreshDays,help:'공휴일·방학·재량휴업일을 제외한 인정 일수를 입력하세요.'}),
      half ? f('to','종료 시각',{kind:'time'}) : null,
      app ? f('previous','이번 신청 전 사용 일수',{kind:'number',min:0,limit:20,step:.5,help:'이번 신청을 포함한 누적 일수는 PDF에 자동 반영됩니다.'}) : null,
      half ? check(doc,'attended','체험 당일 수업에 참여하는 경우입니다.') : null,
      f('kind','학습 형태',{options:['',...kinds],change:refreshKind}),
      f('destination','목적지',{max:65}),
      typeExtras,
      app ? f('lodging','숙박장소',{required:false,max:45,help:'숙박하는 경우에 입력하세요.'}) : null,
      app ? check(doc,'confirmed','학교 세부 규정과 실제 학사일정의 불허기간을 확인했습니다.') : null
    ])
  ];
  if (app) sections.push(
    group('보호자·인솔자 정보', [
      f('guardian','보호자 성명',{max:20}),f('guardianRel','보호자 관계',{max:12}),f('guardianPhone','보호자 휴대폰',{kind:'tel',max:22}),
      el('div', {},button('보호자 정보로 인솔자 채우기', () => {
        doc.leader = doc.guardian; doc.leaderRel = doc.guardianRel; doc.leaderPhone = doc.guardianPhone;
        renderEditor(); $('input-leader')?.focus();
      })),
      f('leader','인솔자 성명',{max:20}),f('leaderRel','인솔자 관계',{max:12}),f('leaderPhone','인솔자 휴대폰',{kind:'tel',max:22})
    ]),
    group('체험학습 계획', [
      f('purpose','목적',{kind:'textarea',wide:true,max:350}),
      f('plan','체험학습 계획',{kind:'textarea',wide:true,max:1500,help:'날짜별 장소와 활동을 적어 주세요.'})
    ])
  );
  else {
    sections.push(group('결과보고서 정보',[
      f('guardian','보호자(동반자) 성명',{max:20}),
      f('title','보고서 제목',{max:65})
    ]), reportDays);
    refreshDays();
  }
  sections.push(group('작성일과 서명', [
    f('signed','작성일',{kind:'date',wide:true}),
    signature(doc,'guardianSignature','보호자 서명'),
    signature(doc,'studentSignature','학생 서명')
  ], '서명은 해당자가 직접 그리거나 출력 후 서명할 수 있습니다.'));
  editor.replaceChildren(...sections);
}

const columns = [
  ['학년','grade'],['반','classroom'],['번호','number'],['성명','name'],['학생휴대폰','studentPhone','application'],
  ['신청단위','unit','both'],['시작일','start','both'],['종료일','end','both'],['일수','days','both'],
  ['시작시각','from','both'],['종료시각','to','both'],['이전사용일수','previous','application'],
  ['학습형태','kind','both'],['목적지','destination','both'],['숙박장소','lodging','application'],
  ['보호자','guardian','both'],['보호자관계','guardianRel','application'],['보호자휴대폰','guardianPhone','application'],
  ['인솔자','leader','application'],['인솔자관계','leaderRel','application'],['인솔자휴대폰','leaderPhone','application'],
  ['목적','purpose','application'],['체험학습계획','plan','application'],
  ['규정확인','confirmed','application'],['당일수업참여','attended','both'],['심각단계확인','severe','both'],
  ['신청서작성일','signed','application'],['보고서작성일','signed','report'],['보고서제목','title','report'],
  ['보고서동반자','guardian','report'],
  ...Array.from({length:5}, (_, i) => [
    [i+1+'일차날짜','dayDate'+(i+1),'report'], [i+1+'일차기록','body'+(i+1),'report']
  ]).flat()
];
const identityKeys = ['grade','classroom','number','name'];
const commonKeys = ['unit','start','end','days','from','to','kind','destination','lodging','attended','severe','plan','purpose'];
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
function writeRosterTemplate(format) {
  const xlsx = spreadsheet();
  const headers = columns.map(([name]) => name);
  if (format === 'csv') {
    downloadBytes('\uFEFF'+headers.join(',')+'\r\n', '교외체험학습_학급명단.csv','text/csv;charset=utf-8');
    return;
  }
  const book = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet([headers]);
  sheet['!cols'] = headers.map(() => ({wch:16}));
  xlsx.utils.book_append_sheet(book, sheet, '명단');
  downloadBytes(xlsx.write(book,{bookType:'xlsx',type:'array'}),'교외체험학습_학급명단.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
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
    people.push(newPerson()); selected = people.length-1;
    showRoster(); renderEditor(); feedback(); $('input-name')?.focus();
  });
  const remove = button('선택 학생 삭제', () => {
    if (!person() || !confirm('선택한 학생의 입력 내용을 삭제할까요?')) return;
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
      button('CSV 양식',()=>writeRosterTemplate('csv')), button('엑셀 양식',()=>writeRosterTemplate('xlsx')), add),
    el('p',{className:'hint' + (rosterError?' roster-error':''),role:'status'},rosterNotice),
    people.length ? list : null,
    people.length ? el('div',{className:'actions batch-actions'},
      button('선택 학생의 공통 내용 복사', copyCommon),
      button('현재 서식 ZIP',()=>runBusy(()=>batchDownload([type]))),
      button('두 서식 ZIP',()=>runBusy(()=>batchDownload(['application','report'])),'primary'), remove) : null);
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
  const [headers,...rows] = matrix;
  const aliases = new Map([['이름','성명'],['이름성명','성명'],['학생명','성명'],['학생이름','성명'],['학급','반'],['번','번호'],['보호자명','보호자']]);
  const names = headers.map(value => aliases.get(normalized(value)) ?? normalized(value));
  const fields = columns.map(([header,key,doc])=>[names.indexOf(normalized(header)),key,doc]);
  if (fields.slice(0,4).some(([i])=>i===-1)) throw Error('첫 행의 필수 열인 학년, 반, 번호, 성명을 확인해 주세요.');
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
  rosterMessage(imported.length+'명을 불러왔습니다.');
  renderEditor(); feedback();
}
function copyCommon() {
  const source = person()?.[type];
  if (!source || people.length < 2) { rosterMessage('학생 2명 이상을 등록해 주세요.',true); return; }
  if (!confirm('현재 서식의 일정·목적지와 공통 계획을 다른 학생에게 복사할까요? 입력된 공통 항목만 덮어씁니다.')) return;
  for (const entry of people) {
    if (entry === person()) continue;
    for (const key of commonKeys) if (source[key] != null && source[key] !== '') entry[type][key] = source[key];
  }
  rosterMessage((people.length-1)+'명에게 공통 내용을 복사했습니다.');
}

function fileName(entry, doc) {
  const {grade,classroom,number,name} = entry.identity;
  const safe = value => String(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,30);
  return [grade+'학년',classroom+'반',number+'번',name,labels[doc]].map(safe).join('_')+'.pdf';
}
function assess(entry, doc) {
  const data = dataFor(entry, doc);
  const result = validate(data,doc);
  if (!['1일','반일'].includes(data.unit)) result.errors.unit = '신청 단위는 1일 또는 반일로 입력해 주세요.';
  return {data,...result};
}
async function runBusy(action, roster = false) {
  if (busy) return;
  busy = true;
  const deactivate = () => document.querySelectorAll('button:not(#close-preview),input,select,textarea').forEach(control=>{control.disabled = true;});
  deactivate();
  try { await action(); }
  catch (error) {
    const message = error?.message || '요청을 처리하지 못했습니다.';
    if (roster) rosterMessage(message,true);
    else feedback([message],true,true);
  } finally {
    document.querySelectorAll('button:disabled,input:disabled,select:disabled,textarea:disabled').forEach(control=>{control.disabled=false;});
    busy = false;
  }
}
async function renderPreview(pdfBytes, title) {
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
  const bytes = await zip.generateAsync({type:'uint8array',compression:'STORE'});
  downloadBytes(bytes,'경안고_교외체험학습_'+(types.length===1?labels[types[0]]:'신청서_결과보고서')+'_'+people.length+'명.zip','application/zip');
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
    type = value; renderEditor(); feedback();
  };
}
$('preview').onclick = () => runBusy(()=>singleAction(true));
$('download').onclick = () => runBusy(()=>singleAction(false));
$('close-preview').onclick = () => $('preview-dialog').close();
$('preview-dialog').addEventListener('close', () => {
  previewGeneration++;
  previewTask?.destroy().catch(()=>{});
  previewTask = undefined;
  $('preview-pages').replaceChildren();
});
$('reset').onclick = () => {
  if (!confirm('이 탭의 학생·학부모 입력과 교사용 학급 명단을 모두 지울까요?')) return;
  individual = newPerson(); people = []; selected = 0; rosterNotice = ''; rosterError = false;
  showRoster(); renderEditor(); feedback(['입력한 내용을 지웠습니다.']);
};
editor.addEventListener('submit',event=>event.preventDefault());
renderEditor();


