export const engineParityLabels = {
  en: { transpose: 'Transpose score', transposeHint: 'Semitones before singing. Compose or load a score first; an existing performance cannot be transposed.', vocals: 'Vocals only', vocalsHint: 'Extract the voice after generation with the installed stem separator. Output is MP3 or 32-bit float WAV.' },
  ru: { transpose: 'Транспонировать партитуру', transposeHint: 'Полутона перед пением. Сначала создайте или загрузите партитуру; готовое исполнение не транспонируется.', vocals: 'Только вокал', vocalsHint: 'Выделить голос после генерации установленной моделью разделения. Результат — MP3 или WAV 32-bit float.' },
  zh: { transpose: '乐谱移调', transposeHint: '演唱前移动的半音数。请先创作或加载乐谱；已有演奏不能移调。', vocals: '仅人声', vocalsHint: '生成后使用已安装的分轨模型提取人声。输出为 MP3 或 32 位浮点 WAV。' },
  ja: { transpose: '楽譜の移調', transposeHint: '歌唱前に移動する半音数。先に楽譜を作成または読み込んでください。既存の演奏は移調できません。', vocals: 'ボーカルのみ', vocalsHint: '生成後、インストール済みの分離モデルで声を抽出します。出力は MP3 または32ビット浮動小数点 WAV。' },
  ko: { transpose: '악보 조옮김', transposeHint: '노래하기 전에 이동할 반음 수. 먼저 악보를 만들거나 불러오세요. 기존 연주는 조옮김할 수 없습니다.', vocals: '보컬만', vocalsHint: '생성 후 설치된 분리 모델로 목소리를 추출합니다. 출력은 MP3 또는 32비트 부동소수점 WAV입니다.' },
};
export const planLabels = { en: 'Score plans', ru: 'Варианты партитуры', zh: '乐谱方案', ja: '楽譜の候補', ko: '악보 후보' };
