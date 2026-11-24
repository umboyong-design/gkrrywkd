export const purposes = {
  '가족동반여행':['가족여행','가족 간 유대감 형성','지역문화 탐방','직접 입력'],
  '친·인척 방문':['조부모 방문','친척 방문','가족 교류','직접 입력'],
  '답사·견학 활동':['대학 탐방','역사유적지 답사','박물관 견학','문화유산 탐방','기업 견학','직접 입력'],
  '체험활동':['진로 탐색','직업 체험','자연환경 탐구','과학 체험','예술·문화 체험','직접 입력'],
  '가정학습':['가정학습','직접 입력']
};
export const relations = ['부','모','조부','조모','외조부','외조모','형제·자매','친·인척','기타'];
export const emptyCalendar = [];
export const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
export const schoolDate = value => validDate(value) && value >= '2026-03-01' && value <= '2027-02-28';
export function moveDate(value, days) {
  return validDate(value) ? new Date(Date.parse(value) + days * 86400000).toISOString().slice(0,10) : '';
}
export function calendarError(rule) {
  if (!['전체','1','2','3'].includes(rule.grade) || !['불허','휴업'].includes(rule.type))
    return '학년과 기간 유형을 선택해 주세요.';
  if (!schoolDate(rule.start) || !schoolDate(rule.end) || rule.end < rule.start)
    return '2026학년도 안에서 시작일과 종료일을 순서대로 입력해 주세요.';
  if (typeof rule.note !== 'string' || !rule.note.trim() || rule.note.length > 60)
    return '기간 이름을 60자 이내로 입력해 주세요.';
  return '';
}
const applies = (rule, grade) => rule.grade === '전체' || rule.grade === String(grade);
export function blockedRanges(data, calendar) {
  const end = data.unit === '반일' ? data.start : data.end;
  if (!schoolDate(data.start) || !schoolDate(end) || end < data.start) return [];
  return calendar.filter(rule => rule.type === '불허' && applies(rule,data.grade) &&
    rule.start <= end && rule.end >= data.start);
}
export function activeDates(data, calendar) {
  const end = data.unit === '반일' ? data.start : data.end;
  if (!schoolDate(data.start) || !schoolDate(end) || end < data.start) return [];
  const closed = calendar.filter(rule => rule.type === '휴업' && applies(rule,data.grade));
  const dates = [];
  for (let date = data.start; date <= end; date = moveDate(date,1)) {
    const weekday = new Date(date).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !closed.some(rule => rule.start <= date && date <= rule.end)) dates.push(date);
  }
  return dates;
}
