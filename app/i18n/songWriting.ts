import type { Language } from './translations';
export const songTokenStrings = {
  en: { tokens: 'tokens', tokenLoading: 'Reading the checkpoint tokenizer…' },
  ru: { tokens: 'токенов', tokenLoading: 'Чтение токенизатора модели…' },
  zh: { tokens: '词元', tokenLoading: '正在读取模型词元…' },
  ja: { tokens: 'トークン', tokenLoading: 'モデルのトークナイザーを読み込み中…' },
  ko: { tokens: '토큰', tokenLoading: '모델 토크나이저를 읽는 중…' },
};
const en = { parts: 'Edit style parts', sections: 'Edit sections', add: 'Add', duplicate: 'Duplicate', remove: 'Delete', up: 'Move up', down: 'Move down', tag: 'Section tag', words: 'Words', language: 'Vocal language', auto: 'Automatic', lines: 'Sung lines', instructions: 'Additional instructions', descriptor: 'Style descriptor' };
export const songWritingStrings: Record<Language, typeof en> = {
  en,
  ru: { parts: 'Стиль по частям', sections: 'Редактор секций', add: 'Добавить', duplicate: 'Дублировать', remove: 'Удалить', up: 'Выше', down: 'Ниже', tag: 'Название секции', words: 'Слова', language: 'Язык вокала', auto: 'Автоматически', lines: 'Строки вокала', instructions: 'Дополнительные указания', descriptor: 'Описание звучания' },
  zh: { parts: '编辑风格元素', sections: '编辑段落', add: '添加', duplicate: '复制', remove: '删除', up: '上移', down: '下移', tag: '段落标签', words: '歌词', language: '演唱语言', auto: '自动', lines: '演唱行数', instructions: '附加说明', descriptor: '风格描述' },
  ja: { parts: 'スタイル要素を編集', sections: 'セクションを編集', add: '追加', duplicate: '複製', remove: '削除', up: '上へ', down: '下へ', tag: 'セクション名', words: '歌詞', language: '歌唱言語', auto: '自動', lines: '歌詞の行数', instructions: '追加の指示', descriptor: '音楽スタイル' },
  ko: { parts: '스타일 요소 편집', sections: '섹션 편집', add: '추가', duplicate: '복제', remove: '삭제', up: '위로', down: '아래로', tag: '섹션 이름', words: '가사', language: '보컬 언어', auto: '자동', lines: '가사 줄 수', instructions: '추가 지시', descriptor: '스타일 설명' },
};
export const songDetailStrings = {
  en: { tempo: 'Tempo', voice: 'Voices', preset: 'Section preset', cycle: 'Next section tag', lineEditor: 'Edit lines and letter case', addLine: 'Add line', duplicateStanza: 'Duplicate stanza', deleteStanza: 'Delete stanza', flipCase: 'Flip letter case', sound: 'Sound / genre', caseHint: 'Click a letter to change its case. The model receives the edited letters.' },
  ru: { tempo: 'Темп', voice: 'Голоса', preset: 'Тип секции', cycle: 'Следующий тип секции', lineEditor: 'Строки и регистр букв', addLine: 'Добавить строку', duplicateStanza: 'Дублировать строфу', deleteStanza: 'Удалить строфу', flipCase: 'Сменить регистр буквы', sound: 'Звучание / жанр', caseHint: 'Нажмите букву, чтобы сменить регистр. Модель получает изменённые буквы.' },
  zh: { tempo: '速度', voice: '人声', preset: '段落类型', cycle: '下一个段落类型', lineEditor: '编辑歌词行和字母大小写', addLine: '添加行', duplicateStanza: '复制诗节', deleteStanza: '删除诗节', flipCase: '切换字母大小写', sound: '音色 / 风格', caseHint: '点击字母切换大小写。模型接收修改后的文字。' },
  ja: { tempo: 'テンポ', voice: '歌声', preset: 'セクションの種類', cycle: '次のセクション名', lineEditor: '行と文字の大小を編集', addLine: '行を追加', duplicateStanza: '詩節を複製', deleteStanza: '詩節を削除', flipCase: '大文字・小文字を切替', sound: 'サウンド / ジャンル', caseHint: '文字をクリックして大文字・小文字を切り替えます。変更後の文字がモデルに送られます。' },
  ko: { tempo: '템포', voice: '목소리', preset: '섹션 유형', cycle: '다음 섹션 유형', lineEditor: '줄과 대소문자 편집', addLine: '줄 추가', duplicateStanza: '연 복제', deleteStanza: '연 삭제', flipCase: '대소문자 전환', sound: '사운드 / 장르', caseHint: '글자를 클릭해 대소문자를 바꿉니다. 수정된 글자가 모델에 전달됩니다.' },
};
