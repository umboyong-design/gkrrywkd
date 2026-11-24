const {PDFDocument, rgb} = globalThis.PDFLib;
const fontkit = globalThis.fontkit;
const ink = rgb(0.035, 0.12, 0.22);
const white = rgb(1, 1, 1);
const gray = rgb(0.94, 0.94, 0.94);

export const kinds = ['가족동반여행', '친·인척 방문', '답사·견학 활동', '체험활동', '가정학습'];
export const labels = {application: '신청서', report: '결과보고서'};

let resources;
function assets() {
  resources ??= Promise.all(['forms.pdf', 'NanumGothic.ttf'].map(async filename => {
    const response = await fetch(new URL('assets/' + filename, import.meta.url), {credentials: 'omit'});
    if (!response.ok) throw Error('문서 양식을 불러오지 못했습니다. 다시 시도해 주세요.');
    return response.arrayBuffer();
  })).catch(error => {
    resources = undefined;
    throw error;
  });
  return resources;
}

export function daysBetween(a, b) {
  return (Date.parse(b) - Date.parse(a)) / 86400000;
}

export function reportCount(data) {
  return data.unit === '반일' ? 1 : Math.min(5, Math.max(1, Math.ceil(Number(data.days) || 1)));
}

export function validate(data, type) {
  const errors = {};
  const warnings = [];
  const required = {
    name:'성명', grade:'학년', classroom:'반', number:'번호', start:'체험 시작일',
    destination:'목적지', guardian:'보호자 성명', signed:'작성일', kind:'학습 형태'
  };
  if (data.unit === '반일') Object.assign(required, {from:'시작 시각', to:'종료 시각'});
  else Object.assign(required, {end:'체험 종료일', days:'출석인정 일수'});
  if (type === 'application') Object.assign(required, {
    previous:'이전 사용 일수', studentPhone:'학생 휴대폰', guardianRel:'보호자 관계',
    guardianPhone:'보호자 휴대폰', leader:'인솔자 성명', leaderRel:'인솔자 관계',
    leaderPhone:'인솔자 휴대폰', purpose:'목적', plan:'체험학습 계획'
  });
  else required.title = '보고서 제목';
  for (const [key, label] of Object.entries(required)) {
    if (!String(data[key] ?? '').trim()) errors[key] = label + ' 항목을 입력해 주세요.';
  }
  for (const [key, min, max, label] of [
    ['grade', 1, 3, '학년'], ['classroom', 1, 99, '반'], ['number', 1, 99, '번호']
  ]) {
    if (!/^\d+$/.test(data[key] ?? '') || Number(data[key]) < min || Number(data[key]) > max)
      errors[key] ??= label + ' 값은 ' + min + '~' + max + ' 사이의 정수여야 합니다.';
  }
  for (const key of ['studentPhone', 'guardianPhone', 'leaderPhone']) {
    if (type === 'application' && data[key] && (!/^\+?[\d() -]+$/.test(data[key]) || !/^\d{9,14}$/.test(data[key].replace(/\D/g, ''))))
      errors[key] = required[key] + ' 번호를 확인해 주세요.';
  }
  if (data.kind && !kinds.includes(data.kind)) errors.kind = '학습 형태를 목록에서 선택해 주세요.';
  if (data.kind === '가정학습' && !data.severe) errors.severe = '가정학습은 감염병 위기경보 심각 단계에서만 가능합니다.';
  const dateOK = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const half = data.unit === '반일';
  const end = half ? data.start : data.end;
  for (const key of half ? ['start', 'signed'] : ['start', 'end', 'signed']) {
    if (data[key] && !dateOK(data[key])) errors[key] = '날짜를 확인해 주세요.';
  }
  for (const key of half ? ['start'] : ['start', 'end']) {
    if (dateOK(data[key]) && (data[key] < '2026-03-01' || data[key] > '2027-02-28'))
      errors[key] = '체험 기간은 2026학년도(2026. 3. 1. ~ 2027. 2. 28.) 안에서 선택해 주세요.';
  }
  if (dateOK(data.start) && dateOK(end) && end < data.start) errors.end = '종료일은 시작일 이후여야 합니다.';
  const days = half ? 0.5 : Number(data.days);
  if (!half && data.days && (!Number.isInteger(days) || days < 1 || days > 5))
    errors.days = '출석인정 일수는 1~5일 사이의 정수로 입력해 주세요.';
  if (!half && dateOK(data.start) && dateOK(end) && end >= data.start && days > daysBetween(data.start, end) + 1)
    errors.days = '출석인정 일수가 입력한 날짜의 범위를 초과합니다.';
  if (half) {
    const time = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? '')
      ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
    const length = time(data.to) - time(data.from);
    if (data.from && !Number.isFinite(time(data.from))) errors.from = '시작 시각을 확인해 주세요.';
    if (data.to && (!Number.isFinite(length) || length <= 0 || length >= 240))
      errors.to = '종료 시각은 시작 시각 이후이며 체험시간은 4시간 미만이어야 합니다.';
    if (!data.attended) errors.attended = '당일 수업 참여 여부를 확인해 주세요.';
  }
  if (type === 'application') {
    if (!data.confirmed) errors.confirmed = '학교 세부 규정과 불허기간을 확인해 주세요.';
    if (String(data.previous ?? '').trim() && !/^\d+(?:\.[05])?$/.test(String(data.previous))) errors.previous = '이전 사용 일수는 0.5일 단위로 입력해 주세요. 사용 이력이 없으면 0을 입력하세요.';
    else if (Number(data.previous) < 0 || Number(data.previous) + days > 20) errors.previous = '이번 신청을 더한 누적 일수가 연간 20일을 초과합니다.';
    if (dateOK(data.signed) && dateOK(data.start)) {
      if (data.signed >= data.start) errors.signed = '신청서 작성일은 체험 시작일보다 앞서야 합니다.';
      else if (daysBetween(data.signed, data.start) < 3) warnings.push('작성일과 시작일 간격이 3일 미만입니다. 학교의 제출 기한을 확인하세요.');
    }
  } else {
    let last = '';
    for (let i = 1; i <= reportCount(data); i++) {
      const fixedDay = half || data.start === end;
      const date = fixedDay ? data.start : data['dayDate' + i];
      if (!dateOK(date) || date < (data.start ?? '') || date > (end ?? '') || date <= last)
        errors['dayDate' + i] = i + '일차 체험일을 체험 기간 안에서 순서대로 입력해 주세요.';
      last = date;
      if (!data['body' + i]?.trim()) errors['body' + i] = i + '일차 활동 내용과 느낀 점을 입력해 주세요.';
    }
    if (dateOK(end) && dateOK(data.signed)) {
      if (data.signed < end) errors.signed = '결과보고서 작성일은 체험 종료일 이후여야 합니다.';
      if (daysBetween(end, data.signed) > 3) warnings.push('종료 후 3일을 초과했습니다. 실제 제출 일정을 담임교사에게 확인하세요.');
    }
    if (!data.proofs?.length) warnings.push('증빙이 PDF에 첨부되지 않았습니다. 제출할 때 증빙을 함께 첨부하세요.');
  }
  if (!data.guardianSignature || !data.studentSignature) warnings.push('PDF에서 비어 있는 서명란은 출력 후 해당자가 직접 서명하세요.');
  return {errors, warnings};
}

// The original Hancom PDF pages are preserved. The positions below are measured
// in the 910×1285 reference raster, with y denoting a top-origin text baseline.
export async function makePDF(data, type) {
  const [templateBytes, fontBytes] = await assets();
  const template = await PDFDocument.load(templateBytes);
  const pdf = await PDFDocument.create();
  pdf.setTitle('경안고등학교 교외체험학습 ' + labels[type]);
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, {subset: false});
  const glyphs = new Set(font.getCharacterSet());
  const dateParts = value => String(value).split('-').map(Number);
  let page;

  const x = pixel => pixel * page.getWidth() / 910;
  const y = pixel => page.getHeight() * (1 - pixel / 1285);
  function box(left, top, width, height, color) {
    page.drawRectangle({x:x(left), y:y(top + height), width:x(width), height:y(top)-y(top+height), color});
  }
  function mark(center, baseline) {
    const points = [[center-4,baseline-5],[center-1,baseline-1],[center+5,baseline-10]];
    for (let i=1;i<points.length;i++) {
      page.drawLine({start:{x:x(points[i-1][0]),y:y(points[i-1][1])},
        end:{x:x(points[i][0]),y:y(points[i][1])},thickness:1.15,color:ink});
    }
  }
  function text(value, left, baseline, width, size = 10, center = false) {
    if (value == null || value === '') return;
    const content = String(value).replace(/\s+/gu, ' ').trim();
    if (!content) return;
    if (Array.from(content).some(char => !glyphs.has(char.codePointAt(0))))
      throw Error('문서에 표시할 수 없는 특수문자나 이모지가 있습니다. 일반 문자로 바꿔 주세요.');
    const measured = font.widthOfTextAtSize(content, size);
    const limit = x(width);
    const fit = Math.min(size, size * limit / measured);
    if (fit < 6.1) throw Error('한 줄 입력 내용이 서식 칸보다 깁니다. 내용을 줄여 주세요.');
    page.drawText(content, {x:x(left) + (center ? (limit - font.widthOfTextAtSize(content, fit))/2 : 0), y:y(baseline), size:fit, font, color:ink});
  }
  function paragraph(value, left, baseline, width, spacing, lineLimit, size, label) {
    const lines = [];
    for (const row of value.replace(/\r\n?/g, '\n').split('\n')) {
      let line = '';
      for (const char of row.replace(/\t/g, '  ')) {
        if (!glyphs.has(char.codePointAt(0)))
          throw Error(label + '에 표시할 수 없는 특수문자나 이모지가 있습니다.');
        if (line && font.widthOfTextAtSize(line + char, size) > x(width)) {
          lines.push(line.trimEnd());
          line = '';
        }
        if (line || char !== ' ') line += char;
      }
      lines.push(line.trimEnd());
    }
    if (lines.length > lineLimit) throw Error(label + '이(가) 서식의 ' + lineLimit + '줄을 초과합니다. 내용을 줄여 주세요.');
    lines.forEach((line, i) => text(line, left, baseline + i * spacing, width, size));
  }
  const add = async index => {
    const [p] = await pdf.copyPages(template, [index]);
    page = pdf.addPage(p);
  };
  function period(report) {
    const [year, month, day] = dateParts(data.start);
    const half = data.unit === '반일';
    const yrX = report ? 353 : 407;
    const baseline = report ? (half ? 238 : 201) : (half ? 171 : 152);
    if (year !== 2026) {
      box(yrX - 1, baseline - 13, 50, 15, white);
      text(year + '년', yrX, baseline, 49, 10);
    }
    const parts = half ? (
      report ? [411,459,537,582,632,682] : [467,514,557,604,670,713]
    ) : (report ? [411,459,529,577,626] : [467,514,579,627,678]);
    let values;
    if (half) values = [month, day, ...data.from.split(':'), ...data.to.split(':')];
    else {
      const [endYear, endMonth, endDay] = dateParts(data.end);
      if (endYear !== year) {
        const start = report ? 517 : 575;
        box(start, baseline - 13, report ? 185 : 175, 15, white);
        text(endYear + '년 ' + endMonth + '월 ' + endDay + '일 (' + data.days + ')일간', start + 3, baseline, 175, 9.3);
        values = [month, day];
      } else values = [month, day, endMonth, endDay, data.days];
    }
    values.forEach((v, i) => text(v, parts[i], baseline, 20, 9, true));
  }
  function learningType(report) {
    if (data.kind === '가정학습') {
      box(report ? 192 : 205, report ? 287 : 433, report ? 617 : 607, report ? 22 : 18, white);
      text('가정학습', report ? 208 : 223, report ? 303 : 447, 145, 10);
      return;
    }
    const centers = report ? [334,488,662,792] : [346,487,657,788];
    mark(centers[kinds.indexOf(data.kind)], report ? 303 : 447);
  }
  async function sign(report) {
    const [year, month, day] = dateParts(data.signed);
    const base = report ? 1014 : 1002;
    if (year !== 2026) {
      const left = report ? 388 : 377;
      box(left-1, base-13, 53, 15, report ? white : gray);
      text(year + (report ? '.' : '년'), left, base, 51, 10);
    }
    text(month, report ? 453 : 448, base, 24, 9, true);
    text(day, report ? 507 : 510, base, 24, 9, true);
    const left = report ? 666 : 689;
    const baseY = report ? 1040 : 1026;
    for (const [i, name, signature] of [[0,data.guardian,data.guardianSignature],[1,data.name,data.studentSignature]]) {
      text(name, left, baseY + i * 26, 65, 9);
      if (signature) {
        const stamp = await pdf.embedPng(signature);
        page.drawImage(stamp, {x:x(left+66), y:y(baseY+i*26+2), width:x(44), height:x(22)});
      }
    }
  }
  function classInfo(report, annex = false) {
    const left = annex ? 187 : report ? 191 : 204;
    const base = annex ? 151 : report ? 172 : 124;
    text(data.name, left+3, base, 176, 10, true);
    const locations = annex ? [565,639,703] : report ? [542,637,713] : [405,476,529];
    [data.grade, data.classroom, data.number].forEach((v,i) => text(v,locations[i],base,22,9,true));
  }
  if (type === 'application') {
    await add(0);
    classInfo(false);
    text(data.studentPhone, 665, 124, 142, 9, true);
    period(false);
    const days = data.unit === '반일' ? 0.5 : Number(data.days);
    text(days, 530, 192, 40, 8, true);
    text(Number(data.previous) + days, 714, 192, 38, 8, true);
    mark(722, 234);
    learningType(false);
    text(data.destination, 210, 470, 302);
    text(data.lodging, 627, 470, 177, 9);
    for (const [base, person, relation, phone] of [[495,data.guardian,data.guardianRel,data.guardianPhone],[522,data.leader,data.leaderRel,data.leaderPhone]]) {
      text(person, 207, base, 170, 9, true);
      text(relation, 435, base, 81, 9, true);
      text(phone, 625, base, 180, 9, true);
    }
    paragraph(data.purpose, 212, 553, 589, 19, 4, 10, '목적');
    paragraph(data.plan, 212, 644, 589, 19, 17, 10, '체험학습 계획');
    await sign(false);
  } else {
    const count = reportCount(data);
    await add(1);
    classInfo(true);
    period(true);
    text(data.destination, 197, 275, 267);
    text(data.guardian, 601, 275, 204);
    learningType(true);
    text(data.title, 197, 331, 605);
    function daily(i, left, top, spacing, lines) {
      const value = data.unit === '반일' || data.start === data.end ? data.start : data['dayDate'+i];
      const [year, month, day] = dateParts(value);
      paragraph(year + '. ' + month + '. ' + day + '.\n' + data['body'+i], left, top, 690, spacing, lines, 10.7, i + '일차 기록');
    }
    daily(1, 111, 405, 29.3, 19);
    await sign(true);
    for (let i = 2; i <= count; i++) {
      await add(2);
      classInfo(true, true);
      daily(i, 111, 194, 38.6, 25);
    }
    for (const [i, file] of (data.proofs ?? []).entries()) {
      const bytes = await file.arrayBuffer();
      let photo;
      try {
        photo = file.type === 'image/png' || /\.png$/i.test(file.name)
          ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      } catch {
        throw Error((i + 1) + '번째 증빙을 읽을 수 없습니다. JPG 또는 PNG 사진인지 확인해 주세요.');
      }
      page = pdf.addPage([595,841]);
      text('교외체험학습 증빙 ' + (i + 1) + ' · ' + data.name, 70, 75, 770, 13);
      const scale = Math.min(510 / photo.width, 702 / photo.height);
      const width = photo.width * scale;
      const height = photo.height * scale;
      page.drawImage(photo, {x:(595-width)/2,y:45+(702-height)/2,width,height});
    }
  }
  return pdf.save();
}




