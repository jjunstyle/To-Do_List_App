// ==========================================================================
// 데이터 관리 로직
// ==========================================================================

const STORAGE_KEY = 'todos';

let todos = loadTodos();
let idCounter = 0;

function generateId() {
  return `${Date.now()}-${idCounter++}`;
}

function loadTodos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveTodos(todos) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
}

function addTodo(text, category) {
  const trimmed = (text || '').trim();
  if (!trimmed) return;

  const newTodo = {
    id: generateId(),
    text: trimmed,
    category,
    completed: false,
    createdAt: Date.now(),
  };

  todos.push(newTodo);
  saveTodos(todos);
  return newTodo;
}

function updateTodo(id, newText, newCategory) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;

  todo.text = (newText || '').trim();
  todo.category = newCategory;
  saveTodos(todos);
}

function deleteTodo(id) {
  todos = todos.filter((t) => t.id !== id);
  saveTodos(todos);
}

function toggleComplete(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;

  todo.completed = !todo.completed;
  saveTodos(todos);
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
  work: ['회의', '보고서', '이메일', '미팅', '프로젝트', '발표', '출장', '결재', '기획', '계약', '고객', '클라이언트', '마감', '업무', '회사', '면접', '인터뷰', '품의', '예산', '컸퍼런스'],
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
// DOM 참조
// ==========================================================================

const taskListEl = document.querySelector('.task-list');
const filterTabsEl = document.querySelector('.filter-tabs');
const addInputEl = document.querySelector('.add-task__input');
const addCategoryEl = document.querySelector('.add-task__category');
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
// .task-item__text::after transition-duration와 반드시 같은 값을 유지한다.
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
  if (!textEl) return;

  const originalText = textEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'task-item__edit-input';
  input.value = originalText;

  li.classList.add('is-editing');
  textEl.replaceWith(input);
  input.focus();
  input.select();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // add-task__input과 동일한 이유로 IME 조합 확정 Enter는 무시한다.
      if (e.isComposing || e.keyCode === 229) return;

      e.preventDefault();
      const id = li.dataset.id;
      const todo = todos.find((t) => t.id === id);
      if (todo) {
        updateTodo(id, input.value, todo.category);
      }
      applyFilterAndRender();
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
  // 글자를 다시 흘려 넣은 값을 읽어 "마지막 글자만 있는 할 일"이 추가된다.
  // isComposing(구형 Safari 대비 keyCode 229도 함께 확인)이면 무시한다.
  if (e.isComposing || e.keyCode === 229) return;

  e.preventDefault();
  handleAddTodo();
});

function handleAddTodo() {
  const categoryLabel = CATEGORY_CODE_TO_LABEL[addCategoryEl.value];
  const created = addTodo(addInputEl.value, categoryLabel);
  if (!created) return;

  addInputEl.value = '';
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

if (todos.length === 0) {
  addTodo('분기 보고서 초안 작성', '업무');
  addTodo('타입스크립트 제네릭 정리', '학습');
  const seeded = addTodo('장보기 — 우유 · 계란 · 식빵', '일상');
  if (seeded) toggleComplete(seeded.id);
}

applyFilterAndRender();
