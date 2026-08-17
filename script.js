// ==========================================================================
// 데이터 관리 로직
// (Supabase "To_Do_List" 테이블이 단일 소스다. 로컬 todos 배열은 그 캐시로,
//  변경 함수는 캐시를 먼저 낙관적으로 갱신해 화면이 즉시 반응하게 만들고
//  Supabase 쓰기는 persist* 함수를 통해 백그라운드로 던진다 — 호출부는
//  이전 saveTodos()처럼 따로 기다리거나 저장을 신경 쓸 필요가 없고,
//  네트워크 실패 시에는 콘솔에만 에러를 남긴다)
// ==========================================================================

const SUPABASE_URL = 'https://aosiieamvurouzcqgzcr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_U_QdF_dcMQnW_iYEi-MFUQ_4EtfM81M';
const TABLE_NAME = 'To_Do_List';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let todos = [];
let idCounter = 0;

function generateId() {
  return `${Date.now()}-${idCounter++}`;
}

async function loadTodos() {
  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .select('*')
    .order('createdAt', { ascending: true });

  if (error) {
    console.error('할 일 목록을 불러오지 못했습니다:', error);
    return [];
  }
  return data;
}

function persistInsert(todo) {
  supabaseClient
    .from(TABLE_NAME)
    .insert(todo)
    .then(({ error }) => {
      if (error) console.error('할 일 저장에 실패했습니다:', error);
    });
}

function persistUpdate(id, changes) {
  supabaseClient
    .from(TABLE_NAME)
    .update(changes)
    .eq('id', id)
    .then(({ error }) => {
      if (error) console.error('할 일 수정에 실패했습니다:', error);
    });
}

function persistDelete(id) {
  supabaseClient
    .from(TABLE_NAME)
    .delete()
    .eq('id', id)
    .then(({ error }) => {
      if (error) console.error('할 일 삭제에 실패했습니다:', error);
    });
}

function addTodo(text, category, dueDate) {
  const trimmed = (text || '').trim();
  if (!trimmed) return;

  const newTodo = {
    id: generateId(),
    text: trimmed,
    category,
    completed: false,
    createdAt: Date.now(),
    dueDate: dueDate || null,
  };

  todos.push(newTodo);
  persistInsert(newTodo);
  return newTodo;
}

function updateTodo(id, newText, newCategory, newDueDate) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;

  todo.text = (newText || '').trim();
  todo.category = newCategory;
  todo.dueDate = newDueDate || null;
  persistUpdate(id, { text: todo.text, category: todo.category, dueDate: todo.dueDate });
}

function deleteTodo(id) {
  todos = todos.filter((t) => t.id !== id);
  persistDelete(id);
}

function toggleComplete(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;

  todo.completed = !todo.completed;
  persistUpdate(id, { completed: todo.completed });
}

function getRemainingCount(todos) {
  return todos.filter((t) => !t.completed).length;
}

// ==========================================================================
// 카테고리 코드 ↔ 라벨 매핑
// (select/필터 탭/CSS는 영문 코드를 쓰고, 데이터는 한글 라벨을 저장한다)
// ==========================================================================

const CATEGORY_CODE_TO_LABEL = { work: '업무', study: '학습', daily: '일상' };
const CATEGORY_LABEL_TO_CODE = { 업무: 'work', 학습: 'study', 일상: 'daily' };
const FILTER_CODE_TO_LABEL = { all: null, work: '업무', study: '학습', daily: '일상' };

// ==========================================================================
// 키워드 기반 카테고리 자동 분류
// (work → study → daily 순으로 검사해 먼저 매칭되는 카테고리를 사용한다)
// ==========================================================================

const CATEGORY_KEYWORDS = {
  work: ['회의', '보고서', '이메일', '미팅', '프로젝트', '발표', '출장', '결재', '기획', '계약', '고객', '클라이언트', '마감', '업무', '회사', '면접', '인터뷰', '품의', '예산', '컴퍼런스'],
  study: ['공부', '강의', '시험', '과제', '수업', '자격증', '코딩', '알고리즘', '논문', '복습', '예습', '스터디', '독서', '토익', '토플', '학원', '수강', '문제집', '단어장', '학습'],
  daily: ['장보기', '청소', '빨래', '운동', '헬스', '산책', '병원', '약속', '가족', '저녁', '요리', '쇼핑', '은행', '세탁', '여행', '취미', '반려동물', '강아지', '고양이', '생일', '약국', '미용실'],
};

function detectCategoryFromText(text) {
  const trimmed = (text || '').trim().toLowerCase();
  if (!trimmed) return null;

  for (const code of ['work', 'study', 'daily']) {
    if (CATEGORY_KEYWORDS[code].some((keyword) => trimmed.includes(keyword.toLowerCase()))) {
      return code;
    }
  }
  return null;
}

// ==========================================================================
// 날짜 포맷팅
// (Input Date는 생성 시각(createdAt, epoch ms)을, Due Date는
//  <input type="date">가 내놓는 "YYYY-MM-DD" 문자열을 받아
//  화면 표기용 "YYYY/MM/DD" 문자열로 바꿔다)
// ==========================================================================

function formatTimestampYMD(timestamp) {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

function formatDueDateYMD(isoDateStr) {
  if (!isoDateStr) return '';
  // Date 객체로 파싱하면 로컬 타임존에 따라 하루가 밀릴 수 있어
  // "YYYY-MM-DD" 문자열을 직접 쪽개 재조립한다.
  const [y, m, d] = isoDateStr.split('-');
  return `${y}/${m}/${d}`;
}

// ==========================================================================
// DOM 참조
// ==========================================================================

const taskListEl = document.querySelector('.task-list');
const filterTabsEl = document.querySelector('.filter-tabs');
const addInputEl = document.querySelector('.add-task__input');
const addCategoryEl = document.querySelector('.add-task__category');
const addDueDateEl = document.querySelector('.add-task__due-date');
const addButtonEl = document.querySelector('.add-task__button');
const addHintEl = document.querySelector('.add-task__hint');
const headlineEl = document.querySelector('.masthead__headline');
const remainingCountEl = document.querySelector('.headline__number');
const remainingCaptionEl = document.querySelector('.headline__caption');

let currentFilter = 'all';

// 사용자가 카테고리를 직접 선택하면, 같은 입력을 계속 수정하는 동안은
// 자동 분류가 그 선택을 덮어쓰지 않는다. 할 일을 추가하면 다시 초기화된다.
let categoryManuallySet = false;

// 취소선 애니메이션(CSS transition: 0.45s)이 끝날 때까지 기다린 뒤
// 완료 항목을 하단으로 재정렬하기 위한 지연 시간. style.css의
// .task-item__text::after transition-duration과 반드시 같은 값을 유지한다.
const STRIKE_ANIMATION_MS = 450;

// ==========================================================================
// 렌더링
// ==========================================================================

function updateRemainingCount() {
  const remaining = getRemainingCount(todos);

  if (remaining === 0) {
    headlineEl.classList.add('is-empty');
    remainingCountEl.textContent = '';
    remainingCaptionEl.textContent = '오늘 할 일을 모두 마쳤습니다';
  } else {
    headlineEl.classList.remove('is-empty');
    remainingCountEl.textContent = remaining;
    remainingCaptionEl.innerHTML = '개의 할 일이<br>남아있습니다';
  }
}

function renderTodos(filteredTodos) {
  taskListEl.innerHTML = '';

  if (filteredTodos.length === 0) {
    taskListEl.appendChild(createEmptyStateElement());
    return;
  }

  // 완료 항목은 하단으로: sort는 안정 정렬이므로 같은 완료 상태 안에서는
  // 기존 순서(생성 순서)가 그대로 유지된다.
  const sorted = [...filteredTodos].sort((a, b) => Number(a.completed) - Number(b.completed));

  sorted.forEach((todo, index) => {
    taskListEl.appendChild(createTaskItemElement(todo, index));
  });
}

function createEmptyStateElement() {
  const li = document.createElement('li');
  li.className = 'task-list__empty';
  li.textContent =
    todos.length === 0
      ? '아직 등록된 할 일이 없습니다 — 새로운 할 일을 추가해보세요.'
      : '해당 카테고리에는 할 일이 없습니다.';
  return li;
}

function createTaskItemElement(todo, index) {
  const categoryCode = CATEGORY_LABEL_TO_CODE[todo.category] || 'work';

  const li = document.createElement('li');
  li.className = 'task-item' + (todo.completed ? ' is-done' : '');
  li.dataset.id = todo.id;
  li.dataset.category = categoryCode;

  li.innerHTML = `
    <label class="task-item__check">
      <input type="checkbox" class="task-item__checkbox-input" ${todo.completed ? 'checked' : ''}>
      <span class="task-item__checkbox" aria-hidden="true"></span>
    </label>
    <span class="task-item__index">${String(index + 1).padStart(2, '0')}</span>
    <span class="task-item__text"></span>
    <span class="task-item__category task-item__category--${categoryCode}"></span>
    <div class="task-item__actions">
      <button type="button" class="icon-btn icon-btn--edit" aria-label="수정">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square">
          <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/>
        </svg>
      </button>
      <button type="button" class="icon-btn icon-btn--delete" aria-label="삭제">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square">
          <path d="M5 5l14 14M19 5L5 19"/>
        </svg>
      </button>
    </div>
    <div class="task-item__meta">
      <span class="task-item__meta-item task-item__meta-item--created">입력일 ${formatTimestampYMD(todo.createdAt)}</span>
      ${todo.dueDate ? `<span class="task-item__meta-item task-item__meta-item--due">마감일 ${formatDueDateYMD(todo.dueDate)}</span>` : ''}
    </div>
  `;

  li.querySelector('.task-item__text').textContent = todo.text;
  li.querySelector('.task-item__category').textContent = todo.category;

  return li;
}

function applyFilterAndRender() {
  const label = FILTER_CODE_TO_LABEL[currentFilter];
  const filtered = label ? todos.filter((t) => t.category === label) : todos;
  renderTodos(filtered);
  updateRemainingCount();
}

// ==========================================================================
// 인라인 수정 모드
// ==========================================================================

function enterEditMode(li) {
  if (li.classList.contains('is-editing')) return;

  const textEl = li.querySelector('.task-item__text');
  const metaEl = li.querySelector('.task-item__meta');
  if (!textEl || !metaEl) return;

  const id = li.dataset.id;
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'task-item__edit-input';
  textInput.value = textEl.textContent;

  const dueDateInput = document.createElement('input');
  dueDateInput.type = 'date';
  dueDateInput.className = 'task-item__edit-due-date';
  dueDateInput.setAttribute('aria-label', '마감일 수정 (선택 사항)');
  dueDateInput.value = todo.dueDate || '';

  const dueDateWrap = document.createElement('span');
  dueDateWrap.className = 'task-item__meta-item';
  dueDateWrap.append('마감일 ', dueDateInput);

  li.classList.add('is-editing');
  textEl.replaceWith(textInput);

  const existingDueEl = metaEl.querySelector('.task-item__meta-item--due');
  if (existingDueEl) {
    existingDueEl.replaceWith(dueDateWrap);
  } else {
    metaEl.appendChild(dueDateWrap);
  }

  textInput.focus();
  textInput.select();

  function commitEdit() {
    updateTodo(id, textInput.value, todo.category, dueDateInput.value);
    applyFilterAndRender();
  }

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // add-task__input과 동일한 이유로 IME 조합 확정 Enter는 무시한다.
      if (e.isComposing || e.keyCode === 229) return;

      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      applyFilterAndRender();
    }
  });

  dueDateInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      applyFilterAndRender();
    }
  });
}

// ==========================================================================
// 이벤트 바인딩 (이벤트 위임 — 목록은 렌더링 때마다 새로 그려지므로
// 개별 항목이 아닌 상위 컨테이너에 한 번만 바인딩한다)
// ==========================================================================

addButtonEl.addEventListener('click', handleAddTodo);

addInputEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  // 한글 등 IME 조합 중 Enter는 조합 확정용 keydown과 실제 Enter keydown이
  // 연달아 발생할 수 있다. 조합 확정 이벤트를 그대로 처리하면 같은 Enter로
  // addTodo가 두 번 호출되고, 두 번째 호출은 입력창을 비운 직후 IME가 마지막
  // 글자를 다시 흔려 넣은 값을 읽어 "마지막 글자만 있는 할 일"이 추가된다.
  // isComposing(구형 Safari 대비 keyCode 229도 함께 확인)이면 무시한다.
  if (e.isComposing || e.keyCode === 229) return;

  e.preventDefault();
  handleAddTodo();
});

function handleAddTodo() {
  const categoryLabel = CATEGORY_CODE_TO_LABEL[addCategoryEl.value];
  const created = addTodo(addInputEl.value, categoryLabel, addDueDateEl.value);
  if (!created) return;

  addInputEl.value = '';
  addDueDateEl.value = '';
  addHintEl.textContent = '';
  categoryManuallySet = false;
  applyFilterAndRender();
  addInputEl.focus();
}

// 카테고리를 직접 고르면 이번 입력에 한해 자동 분류를 멈추다.
addCategoryEl.addEventListener('change', () => {
  categoryManuallySet = true;
  addHintEl.textContent = '';
});

// 입력하는 동안 키워드를 감지해 카테고리를 실시간으로 자동 선택한다.
addInputEl.addEventListener('input', () => {
  if (categoryManuallySet) return;

  const detected = detectCategoryFromText(addInputEl.value);
  if (detected) {
    addCategoryEl.value = detected;
    addHintEl.textContent = `키워드 감지 · ${CATEGORY_CODE_TO_LABEL[detected]} 카테고리로 자동 분류됨`;
  } else {
    addHintEl.textContent = '';
  }
});

filterTabsEl.addEventListener('click', (e) => {
  const tab = e.target.closest('.filter-tab');
  if (!tab) return;

  filterTabsEl.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('is-active'));
  tab.classList.add('is-active');
  currentFilter = tab.dataset.filter;
  applyFilterAndRender();
});

taskListEl.addEventListener('change', (e) => {
  if (!e.target.classList.contains('task-item__checkbox-input')) return;

  const li = e.target.closest('.task-item');
  toggleComplete(li.dataset.id);
  updateRemainingCount();

  // 체크 즉시 같은 li에 is-done을 토글해 취소선 그리기 애니메이션이
  // 재생되도록 하고, 애니메이션이 끝난 뒤 완료 항목을 하단으로
  // 재정렬하기 위해 전체 재렌더링은 지연시킨다.
  li.classList.toggle('is-done', e.target.checked);
  window.setTimeout(applyFilterAndRender, STRIKE_ANIMATION_MS);
});

taskListEl.addEventListener('click', (e) => {
  const deleteBtn = e.target.closest('.icon-btn--delete');
  if (deleteBtn) {
    const li = deleteBtn.closest('.task-item');
    deleteTodo(li.dataset.id);
    applyFilterAndRender();
    return;
  }

  const editBtn = e.target.closest('.icon-btn--edit');
  if (editBtn) {
    enterEditMode(editBtn.closest('.task-item'));
  }
});

taskListEl.addEventListener('dblclick', (e) => {
  const textEl = e.target.closest('.task-item__text');
  if (!textEl) return;

  enterEditMode(textEl.closest('.task-item'));
});

// ==========================================================================
// 초기 로드
// ==========================================================================

async function init() {
  todos = await loadTodos();

  if (todos.length === 0) {
    addTodo('분기 보고서 초안 작성', '업무');
    addTodo('타입스크립트 제네릭 정리', '학습');
    const seeded = addTodo('장보기 — 우유 · 계란 · 식빵', '일상');
    if (seeded) toggleComplete(seeded.id);
  }

  applyFilterAndRender();
}

init();
