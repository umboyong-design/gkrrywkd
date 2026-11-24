export const columns = [
  ['학년','grade'],['반','classroom'],['번호','number'],['성명','name'],['학생휴대폰','studentPhone','application'],
  ['신청단위','unit','both'],['시작일','start','both'],['종료일','end','both'],
  ['시작시각','from','both'],['종료시각','to','both'],['이전사용일수','previous','application'],
  ['학습형태','kind','both'],['세부목적','purposeChoice','application'],['국내국외','region','both'],
  ['목적지','destination','both'],['숙박장소','lodging','application'],
  ['보호자','guardian','both'],['보호자관계','guardianRel','application'],['보호자휴대폰','guardianPhone','application'],
  ['인솔자','leader','application'],['인솔자관계','leaderRel','application'],['인솔자휴대폰','leaderPhone','application'],
  ['목적','purpose','application'],['체험학습계획','plan','application'],
  ['규정확인','confirmed','application'],['당일수업참여','attended','both'],['심각단계확인','severe','both'],
  ['신청서작성일','signed','application'],['보고서작성일','signed','report'],['보고서제목','title','report'],
  ['보고서동반자','guardian','report'],
  ...Array.from({length:5}, (_, i) => [i+1+'일차기록','body'+(i+1),'report'])
];
