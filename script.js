const $ = id => document.getElementById(id);

const COLORS = [
  "#FFFFFF", "#000000", "#EF4444", "#F97316",
  "#FACC15", "#22C55E", "#3B82F6", "#A855F7"
];

const DEFAULT = {
  ratio: "1:1",
  backgroundMode: "transparent",
  backgroundColor: "#FFFFFF",
  gradientStart: "#E8DCFF",
  gradientEnd: "#C7E8FF",
  gradientAngle: 135,
  text: "여기에 입력하세요",
  fontFamily: "Gowun Dodum",
  fontSize: 30,
  textRotation: 0,
  textColor: "#000000",
  shadowToggle: false,
  shadowDirection: "bottom-right",
  shadowDistance: 3,
  x: 50,
  y: 50,
  imageData: ""
};
const SHARED_TEMPLATES = [
  {
    name: "응원 카드",
    ratio: "4:5",
    url: "https://gywwtgecjkfmgnwkbmzl.supabase.co/storage/v1/object/public/template-images/cheer-up.png",
    jsonUrl: "https://gywwtgecjkfmgnwkbmzl.supabase.co/storage/v1/object/public/template-images/cheer-up.json"
  },
  {
    name: "좋은 하루",
    ratio: "1:1",
    url: "https://gywwtgecjkfmgnwkbmzl.supabase.co/storage/v1/object/public/template-images/good-day.png",
    jsonUrl: "https://gywwtgecjkfmgnwkbmzl.supabase.co/storage/v1/object/public/template-images/good-day.json"
  },
  {
    name: "오늘의 기록",
    ratio: "9:16",
    url: "https://gywwtgecjkfmgnwkbmzl.supabase.co/storage/v1/object/public/template-images/today-record.png",
    jsonUrl: "https://gywwtgecjkfmgnwkbmzl.supabase.co/storage/v1/object/public/template-images/today-record.json"
  }
];

let state = { ...DEFAULT };
let db = null;
let editingTemplateId = null;
let dragging = false;

// --- 편집 히스토리 상태 관리 (최대 20단계) ---
let historyStates = []; // 전체 히스토리 스냅샷 배열
let historyIndex = -1;  // 현재 가리키고 있는 히스토리 인덱스
const MAX_HISTORY = 20;
let isRestoringState = false; // 상태 복원 중 중복 저장 방지용 플래그

const TEXT_KEYS = [
  "text",
  "fontFamily",
  "fontSize",
  "textRotation",
  "textColor",
  "shadowToggle",
  "shadowDirection",
  "shadowDistance",
  "x",
  "y"
];

let textItems = [];
let selectedTextId = null;
let nextTextId = 1;

const defaultText = () =>
  Object.fromEntries(
    TEXT_KEYS.map(key => [key, DEFAULT[key]])
  );

// --- 히스토리 및 Undo/Redo 핵심 함수 ---
// Record the state AFTER the edit. Existing callers usually invoke saveState
// before changing state, so defer the snapshot until the current event finishes.
let historyCaptureQueued = false;
let pendingHistoryDescription = "편집 작업";
function saveState(description = "편집 작업") {
  if (isRestoringState) return;
  pendingHistoryDescription = description;
  if (historyCaptureQueued) return;
  historyCaptureQueued = true;
  queueMicrotask(() => {
    historyCaptureQueued = false;
    if (isRestoringState) return;
    saveSelectedText();
    const currentState = {
      state: { ...state },
      textItems: textItems.map(item => ({ ...item })),
      selectedTextId,
      description: pendingHistoryDescription,
      time: new Date().toLocaleTimeString("ko-KR", {hour:"2-digit",minute:"2-digit",second:"2-digit"})
    };
    const previous = historyStates[historyIndex]
      ? JSON.parse(historyStates[historyIndex]) : null;
    // Avoid duplicate snapshots from focus, clicks, or unchanged controls.
    const signature = data => JSON.stringify({state:data.state, textItems:data.textItems});
    if (previous && signature(previous) === signature(currentState)) return;
    if (historyIndex < historyStates.length - 1) {
      historyStates = historyStates.slice(0, historyIndex + 1);
    }
    historyStates.push(JSON.stringify(currentState));
    if (historyStates.length > MAX_HISTORY) historyStates.shift();
    historyIndex = historyStates.length - 1;
    updateUndoRedoButtons();
    renderHistoryList();
  });
}

function undo() {
  if (historyIndex <= 0) return;
  saveSelectedText();
  historyIndex--;
  const targetState = JSON.parse(historyStates[historyIndex]);
  applyFullState(targetState);
  updateUndoRedoButtons();
  renderHistoryList();
}

function redo() {
  if (historyIndex >= historyStates.length - 1) return;
  saveSelectedText();
  historyIndex++;
  const targetState = JSON.parse(historyStates[historyIndex]);
  applyFullState(targetState);
  updateUndoRedoButtons();
  renderHistoryList();
}

function jumpToHistory(index) {
  if (index < 0 || index >= historyStates.length || index === historyIndex) return;
  saveSelectedText();
  historyIndex = index;
  const targetState = JSON.parse(historyStates[historyIndex]);
  applyFullState(targetState);
  updateUndoRedoButtons();
  renderHistoryList();
}

function applyFullState(savedData) {
  isRestoringState = true;
  state = { ...savedData.state };
  textItems = savedData.textItems.map(item => ({ ...item }));
  selectedTextId = savedData.selectedTextId;
  nextTextId = Math.max(nextTextId, ...textItems.map(item => item.id + 1));

  update(true);
  isRestoringState = false;
}

function updateUndoRedoButtons() {
  const undoBtn = $("undoButton");
  const redoBtn = $("redoButton");
  if (undoBtn) undoBtn.disabled = historyIndex <= 0;
  if (redoBtn) redoBtn.disabled = historyIndex >= historyStates.length - 1;
}

function renderHistoryList() {
  const listContainer = $("historyList");
  if (!listContainer) return;
  
  listContainer.replaceChildren();

  // 역순으로 최신 작업이 위로 오도록 렌더링하거나 정순 렌더링 선택 가능 (여기서는 최신이 위로 오도록 역순 구성 혹은 정순 구성)
  // 사용자가 익숙한 아래로 쌓이는 순서 또는 최신순 선택 (정순 순서로 1부터 표시)
  historyStates.forEach((itemStr, index) => {
    const data = JSON.parse(itemStr);
    const div = document.createElement("div");
    div.className = "history-item";
    if (index === historyIndex) {
      div.classList.add("active");
    }

    const descSpan = document.createElement("span");
    descSpan.className = "history-desc";
    descSpan.textContent = `${index + 1}. ${data.description || '편집 작업'}`;

    const timeSpan = document.createElement("span");
    timeSpan.className = "history-time";
    timeSpan.textContent = data.time || '';

    div.append(descSpan, timeSpan);
    div.onclick = () => jumpToHistory(index);

    listContainer.append(div);
  });

  // 스크롤을 현재 선택된 항목 위치로 부드럽게 조정
  const activeItem = listContainer.querySelector(".history-item.active");
  if (activeItem) {
    listContainer.scrollTop = activeItem.offsetTop - listContainer.offsetTop;
  }
}

// 키보드 단축키 지원 (Ctrl+Z, Ctrl+Y)
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === 'z' && !event.shiftKey) {
    event.preventDefault();
    undo();
  } else if ((event.ctrlKey && event.key.toLowerCase() === 'y') || 
             (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z')) {
    event.preventDefault();
    redo();
  }
});

// UI 버튼 클릭 이벤트 연결
if ($("undoButton")) $("undoButton").onclick = undo;
if ($("redoButton")) $("redoButton").onclick = redo;


function saveSelectedText() {
  const item = textItems.find(
    item => item.id === selectedTextId
  );

  if (item) {
    for (const key of TEXT_KEYS) {
      item[key] = state[key];
    }
  }
}

function selectText(id) {
  saveSelectedText();

  const item = textItems.find(item => item.id === id);
  if (!item) return;

  selectedTextId = id;

  for (const key of TEXT_KEYS) {
    state[key] = item[key];
  }

  update();
}

function resetTexts(settings = state) {
  const loaded = Array.isArray(settings.textItems)
    ? settings.textItems
    : (
        Array.isArray(settings.texts)
          ? settings.texts
          : null
      );

  textItems = loaded && loaded.length
    ? loaded.map(item => ({
        ...defaultText(),
        ...item,
        id: nextTextId++
      }))
    : [
        {
          ...defaultText(),
          ...Object.fromEntries(
            TEXT_KEYS.map(key => [
              key,
              settings[key] ?? DEFAULT[key]
            ])
          ),
          id: nextTextId++
        }
      ];

  for (const key of TEXT_KEYS) {
    state[key] = textItems[0][key];
  }

  selectedTextId = null;
}

resetTexts();

function renderTextItems() {
  saveSelectedText();

  const canvas = $("canvas");
  const base = $("textLayer");

  for (const item of textItems) {
    const existing = canvas.querySelector(
      `.extra-text-layer[data-text-id="${item.id}"]`
    );

    const layer = item.id === textItems[0].id
      ? base
      : (existing || base.cloneNode(true));

    if (layer !== base && !existing) {
      layer.removeAttribute("id");
      layer.classList.add("extra-text-layer");

      const child = layer.querySelector("#overlayText");
      child.removeAttribute("id");
      child.classList.add("extra-overlay-text");

      canvas.append(layer);
    }

    const text = layer.firstElementChild;

    if (document.activeElement !== text) {
      text.textContent = item.text;
    }

    text.style.fontFamily =
      `"${item.fontFamily}", sans-serif`;

    text.style.fontSize = item.fontSize + "px";
    text.style.color = item.textColor;

    const dx = item.shadowDirection.includes("left")
      ? -item.shadowDistance
      : item.shadowDistance;

    const dy = item.shadowDirection.includes("top")
      ? -item.shadowDistance
      : item.shadowDistance;

    text.style.textShadow = item.shadowToggle
      ? `${dx}px ${dy}px 3px #0009`
      : "none";

    layer.style.left = item.x + "%";
    layer.style.top = item.y + "%";

    layer.style.transform =
      `translate(-50%, -50%) rotate(${item.textRotation}deg)`;

    layer.classList.toggle(
      "selected-text-layer",
      item.id === selectedTextId
    );

    layer.dataset.textId = item.id;

    if (layer !== base && !existing) {
      text.addEventListener("input", () => {
        if (selectedTextId !== item.id) {
          selectText(item.id);
        }

        state.text = Array.from(
          text.innerText
        ).slice(0, 120).join("");

        $("textInput").value = state.text;
        update();
        saveState("추가 문구 수정");
      });
    }
  }

  canvas.querySelectorAll(".extra-text-layer").forEach(node => {
    if (
      !textItems.some(
        item => item.id === Number(node.dataset.textId)
      )
    ) {
      node.remove();
    }
  });
}

$("addTextButton").onclick = () => {
  saveState("문구 추가");
  saveSelectedText();

  const item = {
    ...defaultText(),
    id: nextTextId++,
    text: "새 문구",
    x: 50,
    y: Math.min(90, 50 + textItems.length * 12)
  };

  textItems.push(item);
  selectText(item.id);
  update();
};

$("deleteTextButton").onclick = () => {
  saveState("문구 삭제");
  saveSelectedText();

  textItems = textItems.filter(
    item => item.id !== selectedTextId
  );

  if (!textItems.length) {
    textItems.push({
      ...defaultText(),
      id: nextTextId++,
      text: ""
    });
  }

  selectedTextId = null;
  selectText(textItems[textItems.length - 1].id);
  update();
};

let activePointer = null;

$("canvas").addEventListener("pointerdown", event => {
  const layer = event.target.closest(
    "#textLayer, .extra-text-layer"
  );

  if (!layer) {
    saveSelectedText();
    selectedTextId = null;
    renderTextItems();
    return;
  }

  const id = Number(layer.dataset.textId);

  if (id !== selectedTextId) {
    selectText(id);
  }

  if (event.detail >= 2) return;

  activePointer = {
    id: event.pointerId,
    layer
  };

  layer.setPointerCapture(event.pointerId);
  saveState("문구 위치 이동");
});

$("canvas")
  .closest(".stage")
  .addEventListener("pointerdown", event => {
    if ($("canvas").contains(event.target)) return;

    saveSelectedText();
    selectedTextId = null;
    renderTextItems();
  });

$("canvas").addEventListener("pointermove", event => {
  if (
    !activePointer ||
    activePointer.id !== event.pointerId
  ) {
    return;
  }

  const rect = $("canvas").getBoundingClientRect();

  state.x = clamp(
    (event.clientX - rect.left) / rect.width * 100,
    0,
    100
  );

  state.y = clamp(
    (event.clientY - rect.top) / rect.height * 100,
    0,
    100
  );

  update();
});

function endTextPointer() {
  if (activePointer) saveState("문구 위치 이동");
  activePointer = null;
}

$("canvas").addEventListener(
  "pointerup",
  endTextPointer
);

$("canvas").addEventListener(
  "pointercancel",
  endTextPointer
);

const specs = {
  backgroundColor: [
    "backgroundColorPalette",
    "backgroundColorHex"
  ],
  gradientStart: [
    "gradientStartPalette",
    "gradientStartHex"
  ],
  gradientEnd: [
    "gradientEndPalette",
    "gradientEndHex"
  ],
  textColor: [
    "textColorPalette",
    "textColorHex"
  ]
};

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, value));

function normalizeHex(value) {
  let hex = value.trim().toUpperCase();

  if (!hex.startsWith("#")) {
    hex = "#" + hex;
  }

  return /^#[0-9A-F]{6}$/.test(hex)
    ? hex
    : null;
}

function setColor(key, value) {
  const hex = normalizeHex(value);

  if (!hex) return false;

  saveState("색상 변경");
  state[key] = hex;
  update();

  return true;
}

function buildPalette(key) {
  const [containerId, hexId] = specs[key];
  const container = $(containerId);

  for (const color of COLORS) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "swatch";
    button.style.setProperty("--swatch", color);
    button.title = color;
    button.setAttribute("aria-label", color);

    button.onclick = () => {
      setColor(key, color);
    };

    container.append(button);
  }

  const custom = document.createElement("label");
  custom.className = "swatch rainbow";
  custom.title = "직접 색상 선택";

  const picker = document.createElement("input");
  picker.type = "color";
  picker.setAttribute("aria-label", "사용자 지정 색상");

  picker.oninput = () => {
    setColor(key, picker.value);
  };

  custom.append(picker);
  container.append(custom);

  const hexInput = $(hexId);

  hexInput.addEventListener("input", () => {
    const value = normalizeHex(hexInput.value);

    hexInput.classList.toggle("invalid", !value);

    if (value) {
      saveState("색상 코드 입력");
      state[key] = value;
      update(false);
    }
  });

  hexInput.addEventListener("blur", () => {
    hexInput.classList.remove("invalid");
    hexInput.value = state[key];
  });
}

function bindNumber(
  rangeId,
  numberId,
  key,
  min,
  max,
  actionName = "설정 변경"
) {
  const slider = $(rangeId);
  const input = $(numberId);

  slider.addEventListener("pointerdown", () => {
    saveState(actionName);
  });

  input.addEventListener("focus", () => {
    saveState(actionName);
  });

  function change(value, source) {
    if (
      value.trim() === "" ||
      !Number.isFinite(Number(value))
    ) {
      return;
    }

    state[key] = clamp(
      Math.round(Number(value)),
      min,
      max
    );

    update(source !== "number");
    saveState(actionName);
  }

  slider.addEventListener("input", () => {
    change(slider.value, "slider");
  });

  input.addEventListener("input", () => {
    change(input.value, "number");
  });

  input.addEventListener("blur", () => {
    input.value = state[key];
  });
}

function shadowOffset() {
  const distance = state.shadowDistance;
  const direction = state.shadowDirection;

  return [
    direction.includes("left")
      ? -distance
      : distance,
    direction.includes("top")
      ? -distance
      : distance
  ];
}

function update(syncHex = true) {
  document.querySelectorAll(".ratio-btn").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.ratio === state.ratio
    );
  });

  document.querySelectorAll(
    'input[name="backgroundMode"]'
  ).forEach(radio => {
    radio.checked =
      radio.value === state.backgroundMode;
  });

  $("solidControls").hidden =
    state.backgroundMode !== "solid";

  $("gradientControls").hidden =
    state.backgroundMode !== "gradient";

  for (
    const [key, [paletteId, hexId]]
    of Object.entries(specs)
  ) {
    if (
      syncHex ||
      document.activeElement !== $(hexId)
    ) {
      $(hexId).value = state[key];
    }

    $(paletteId)
      .querySelectorAll(".swatch")
      .forEach((button, index) => {
        button.classList.toggle(
          "selected",
          index < COLORS.length &&
          COLORS[index] === state[key]
        );
      });

    $(paletteId)
      .querySelector('input[type="color"]')
      .value = state[key];
  }

  const numberFields = [
    [
      "gradientAngle",
      "gradientAngle",
      "gradientAngleNumber"
    ],
    [
      "fontSize",
      "fontSize",
      "fontSizeNumber"
    ],
    [
      "textRotation",
      "textRotation",
      "textRotationNumber"
    ],
    [
      "shadowDistance",
      "shadowDistance",
      "shadowDistanceNumber"
    ]
  ];

  for (
    const [key, sliderId, numberId]
    of numberFields
  ) {
    $(sliderId).value = state[key];

    if (
      document.activeElement !== $(numberId)
    ) {
      $(numberId).value = state[key];
    }
  }

  if (
    document.activeElement !== $("textInput")
  ) {
    $("textInput").value = state.text;
  }

  if (
    document.activeElement !== $("overlayText")
  ) {
    $("overlayText").textContent = state.text;
  }

  $("textCount").textContent =
    Array.from(state.text).length;

  $("fontFamily").value = state.fontFamily;
  $("shadowToggle").checked = state.shadowToggle;
  $("shadowDirection").value =
    state.shadowDirection;

  $("shadowOptions").hidden =
    !state.shadowToggle;

  const background = $("backgroundLayer");

  if (state.backgroundMode === "solid") {
    background.style.background =
      state.backgroundColor;

  } else if (
    state.backgroundMode === "gradient"
  ) {
    background.style.background =
      `linear-gradient(
        ${state.gradientAngle}deg,
        ${state.gradientStart},
        ${state.gradientEnd}
      )`;

  } else {
    background.style.background = "transparent";
  }

  const image = $("previewImage");

  image.style.display =
    state.imageData ? "block" : "none";

  if (
    state.imageData &&
    image.src !== state.imageData
  ) {
    image.src = state.imageData;
  }

  const ratios = {
    "1:1": "1 / 1",
    "4:5": "4 / 5",
    "9:16": "9 / 16"
  };

  $("canvas").style.aspectRatio =
    ratios[state.ratio];

  const text = $("overlayText");
  const layer = $("textLayer");

  text.style.fontFamily =
    `"${state.fontFamily}", sans-serif`;

  text.style.fontSize =
    state.fontSize + "px";

  text.style.color = state.textColor;

  if (state.shadowToggle) {
    const [x, y] = shadowOffset();

    text.style.textShadow =
      `${x}px ${y}px 3px #0009`;
  } else {
    text.style.textShadow = "none";
  }

  layer.style.left = state.x + "%";
  layer.style.top = state.y + "%";

  layer.style.transform =
    `translate(-50%, -50%) rotate(${state.textRotation}deg)`;

  renderTextItems();

  $("currentRatio").textContent =
    state.ratio;

  $("currentText").textContent =
    state.text || "(빈 문구)";
}

document.querySelectorAll(".ratio-btn").forEach(button => {
  button.onclick = () => {
    saveState("비율 변경");
    state.ratio = button.dataset.ratio;
    update();
  };
});

document.querySelectorAll(
  'input[name="backgroundMode"]'
).forEach(radio => {
  radio.onchange = () => {
    saveState("배경 모드 변경");
    state.backgroundMode = radio.value;
    update();
  };
});

Object.keys(specs).forEach(buildPalette);

bindNumber(
  "gradientAngle",
  "gradientAngleNumber",
  "gradientAngle",
  0,
  360,
  "그라데이션 방향 변경"
);

bindNumber(
  "fontSize",
  "fontSizeNumber",
  "fontSize",
  10,
  120,
  "글자 크기 변경"
);

bindNumber(
  "textRotation",
  "textRotationNumber",
  "textRotation",
  -180,
  180,
  "문구 회전 변경"
);

bindNumber(
  "shadowDistance",
  "shadowDistanceNumber",
  "shadowDistance",
  0,
  30,
  "그림자 거리 변경"
);

$("textInput").onfocus = () => saveState("문구 수정 시작");
$("textInput").oninput = event => {
  state.text = Array.from(
    event.target.value
  ).slice(0, 120).join("");

  update();
  saveState("문구 내용 수정");
};

$("overlayText").onfocus = () => saveState("문구 수정 시작");
$("overlayText").oninput = event => {
  if (
    selectedTextId !== textItems[0].id
  ) {
    selectText(textItems[0].id);
  }

  state.text = Array.from(
    event.target.innerText
  ).slice(0, 120).join("");

  $("textInput").value = state.text;

  update();
  saveState("미리보기 문구 수정");
};

$("fontFamily").onchange = event => {
  saveState("글꼴 변경");
  state.fontFamily = event.target.value;
  update();
};

$("shadowToggle").onchange = event => {
  saveState("그림자 토글");
  state.shadowToggle = event.target.checked;
  update();
};

$("shadowDirection").onchange = event => {
  saveState("그림자 방향 변경");
  state.shadowDirection = event.target.value;
  update();
};

$("imageInput").onchange = event => {
  const file = event.target.files?.[0];

  if (!file) return;

  const allowed = [
    "image/png",
    "image/jpeg",
    "image/webp"
  ];

  if (!allowed.includes(file.type)) {
    alert(
      "PNG, JPEG, WEBP 이미지만 업로드할 수 있어요."
    );
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    saveState("이미지 업로드");
    state.imageData = reader.result;
    update();
  };

  reader.readAsDataURL(file);
};

$("removeImage").onclick = () => {
  saveState("이미지 제거");
  state.imageData = "";
  $("imageInput").value = "";

  $("previewImage").removeAttribute("src");

  update();
};

$("resetButton").onclick = () => {
  saveState("설정 초기화");
  state = { ...DEFAULT };

  resetTexts();

  $("imageInput").value = "";
  $("previewImage").removeAttribute("src");

  update();
};

async function makePNG() {
  if (document.fonts) {
    await document.fonts.ready;
  }

  const preview = $("canvas");
  const previewRect =    preview.getBoundingClientRect();

  if (
    !previewRect.width ||
    !previewRect.height
  ) {
    throw new Error(
      "미리보기 크기를 확인할 수 없습니다."
    );
  }

  const sizes = {
    "1:1": [1080, 1080],
    "4:5": [1080, 1350],
    "9:16": [1080, 1920]
  };

  const [width, height] = sizes[state.ratio];

  const output =
    document.createElement("canvas");

  output.width = width;
  output.height = height;

  const ctx = output.getContext("2d");

  if (!ctx) {
    throw new Error(
      "Canvas를 생성할 수 없습니다."
    );
  }

  const sx = width / previewRect.width;
  const sy = height / previewRect.height;

  if (
    state.backgroundMode === "solid"
  ) {
    ctx.fillStyle = state.backgroundColor;
    ctx.fillRect(0, 0, width, height);

  } else if (
    state.backgroundMode === "gradient"
  ) {
    const angle =
      state.gradientAngle * Math.PI / 180;

    const vx = Math.sin(angle);
    const vy = -Math.cos(angle);

    const half = (
      Math.abs(width * vx) +
      Math.abs(height * vy)
    ) / 2;

    const gradient = ctx.createLinearGradient(
      width / 2 - vx * half,
      height / 2 - vy * half,
      width / 2 + vx * half,
      height / 2 + vy * half
    );

    gradient.addColorStop(
      0,
      state.gradientStart
    );

    gradient.addColorStop(
      1,
      state.gradientEnd
    );

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  if (state.imageData) {
    const image = new Image();

    if (
      /^https?:\/\//i.test(state.imageData)
    ) {
      image.crossOrigin = "anonymous";
    }

    image.src = state.imageData;

    await image.decode();

    const imageStyle = getComputedStyle(
      $("previewImage")
    );

    const fit =
      imageStyle.objectFit || "cover";

    if (fit === "contain") {
      const factor = Math.min(
        width / image.naturalWidth,
        height / image.naturalHeight
      );

      const w =
        image.naturalWidth * factor;

      const h =
        image.naturalHeight * factor;

      ctx.drawImage(
        image,
        (width - w) / 2,
        (height - h) / 2,
        w,
        h
      );

    } else {
      const factor = Math.max(
        width / image.naturalWidth,
        height / image.naturalHeight
      );

      const sw = width / factor;
      const sh = height / factor;

      ctx.drawImage(
        image,
        (image.naturalWidth - sw) / 2,
        (image.naturalHeight - sh) / 2,
        sw,
        sh,
        0,
        0,
        width,
        height
      );
    }
  }

  saveSelectedText();

  const baseStyle = getComputedStyle(
    $("overlayText")
  );

  const segmenter =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter("ko", {
          granularity: "grapheme"
        })
      : null;

  for (const item of textItems) {
    const fontSize = item.fontSize;
    const lineHeight = fontSize * 1.3;

    const font =
      `${baseStyle.fontStyle} ` +
      `${baseStyle.fontWeight} ` +
      `${fontSize}px ` +
      `"${item.fontFamily}", sans-serif`;

    ctx.font = font;

    const maxWidth =
      previewRect.width * 0.86 - 6;

    const lines = [];

    const paragraphs = (
      item.text || ""
    )
      .replace(/\r\n/g, "\n")
      .split("\n");

    for (const paragraph of paragraphs) {
      const chars = segmenter
        ? Array.from(
            segmenter.segment(paragraph),
            part => part.segment
          )
        : Array.from(paragraph);

      let line = "";

      for (const char of chars) {
        if (
          line &&
          ctx.measureText(line + char).width >
            maxWidth
        ) {
          lines.push(line);
          line = char;
        } else {
          line += char;
        }
      }

      lines.push(line);
    }

    ctx.save();

    ctx.translate(
      width * item.x / 100,
      height * item.y / 100
    );

    ctx.rotate(
      item.textRotation * Math.PI / 180
    );

    ctx.scale(sx, sy);

    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = item.textColor;

    if (item.shadowToggle) {
      ctx.shadowColor = "#0009";
      ctx.shadowBlur = 3;

      ctx.shadowOffsetX =
        item.shadowDirection.includes("left")
          ? -item.shadowDistance
          : item.shadowDistance;

      ctx.shadowOffsetY =
        item.shadowDirection.includes("top")
          ? -item.shadowDistance
          : item.shadowDistance;
    }

    const blockHeight =
      lines.length * lineHeight;

    lines.forEach((line, index) => {
      ctx.fillText(
        line,
        0,
        -blockHeight / 2 +
          (index + 0.5) * lineHeight
      );
    });

    ctx.restore();
  }

  return output.toDataURL("image/png");
}

$("saveButton").onclick = async () => {
  const button = $("saveButton");

  button.disabled = true;

  try {
    const link = document.createElement("a");

    link.href = await makePNG();
    link.download = "card-studio.png";

    link.click();

  } catch (error) {
    console.error(error);

    alert(
      "PNG 저장 중 오류가 발생했어요."
    );

  } finally {
    button.disabled = false;
  }
};

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      "CardStudioTemplates",
      1
    );

    request.onupgradeneeded = () => {
      const database = request.result;

      if (
        !database.objectStoreNames.contains(
          "templates"
        )
      ) {
        database.createObjectStore(
          "templates",
          {
            keyPath: "id",
            autoIncrement: true
          }
        );
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

function transaction(mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      "templates",
      mode
    );

    const store =
      tx.objectStore("templates");

    const request = work(store);

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

function stopTemplateEditing() {
  editingTemplateId = null;
  $("createTemplate").textContent = "템플릿 저장";
  $("cancelTemplateEdit").hidden = true;
}

function applyPersonalTemplate(item) {
  saveState("템플릿 불러오기");
  state = { ...DEFAULT, ...item.settings };
  resetTexts(item.settings);
  $("imageInput").value = "";
  $("previewImage").removeAttribute("src");
  update();
}

const cancelTemplateEdit = document.createElement("button");
cancelTemplateEdit.id = "cancelTemplateEdit";
cancelTemplateEdit.type = "button";
cancelTemplateEdit.textContent = "수정 취소";
cancelTemplateEdit.hidden = true;
$("createTemplate").after(cancelTemplateEdit);
cancelTemplateEdit.onclick = () => {
  stopTemplateEditing();
  $("templateName").value = "";
};

async function renderTemplates() {
  const list = $("templateList");

  list.replaceChildren();
  const sharedHeading =
    document.createElement("h4");

  sharedHeading.textContent =
    "기본 템플릿";

  list.append(sharedHeading);

  for (const item of SHARED_TEMPLATES) {
    const row =
      document.createElement("div");

    row.className = "template-item";
    const image =
      document.createElement("img");

    image.src = item.url;
    image.alt =
      item.name + " 미리보기";

    image.loading = "lazy";

    row.append(image);

    const info =
      document.createElement("div");

    info.className = "info";
    info.textContent = item.name;

    const small =
      document.createElement("small");

    small.textContent = item.ratio;

    info.append(small);
    row.append(info);

    const load =
      document.createElement("button");

    load.type = "button";
    load.textContent = "불러오기";
    load.onclick = async () => {
      load.disabled = true;

      const previousLabel =
        load.textContent;

      load.textContent =
        "불러오는 중...";

      try {
        const response = await fetch(
          item.jsonUrl,
          {
            cache: "no-store"
          }
        );

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`
          );
        }

        const data =
          await response.json();
        if (
          !data ||
          typeof data !== "object" ||
          Array.isArray(data)
        ) {
          throw new Error(
            "잘못된 JSON 형식"
          );
        }

        if (
          !["1:1", "4:5", "9:16"]
            .includes(data.ratio)
        ) {
          throw new Error(
            "지원하지 않는 비율"
          );
        }

        if (
          !Array.isArray(data.texts) ||
          !data.texts.length ||
          data.texts.some(
            text =>
              !text ||
              typeof text.text !== "string"
          )
        ) {
          throw new Error(
            "텍스트 정보가 없거나 올바르지 않습니다."
          );
        }
        const nextState = {
          ...DEFAULT,
          ...data,
          imageData: ""
        };

        saveState("기본 템플릿 적용");
        state = nextState;
        resetTexts(nextState);

        $("imageInput").value = "";

        $("previewImage")
          .removeAttribute("src");

        update();

      } catch (error) {
        console.error(
          "기본 템플릿 JSON 불러오기 실패:",
          error
        );

        alert(
          "템플릿 설정을 불러오지 못했어요. " +
          "JSON 주소와 인터넷 연결을 확인해 주세요."
        );

      } finally {
        load.disabled = false;

        load.textContent =
          previousLabel;
      }
    };

    row.append(load);
    list.append(row);
  }

  const personalHeading =
    document.createElement("h4");

  personalHeading.textContent =
    "나의 템플릿";

  list.append(personalHeading);

  if (!db) return;

  const items = await transaction(
    "readonly",
    store => store.getAll()
  );

  for (const item of items.reverse()) {
    const row =
      document.createElement("div");

    row.className = "template-item";

    if (item.thumbnail) {
      const image =
        document.createElement("img");

      image.src = item.thumbnail;
      image.alt = "";

      row.append(image);
    }

    const info =
      document.createElement("div");

    info.className = "info";
    info.textContent = item.name;

    const small =
      document.createElement("small");

    small.textContent =
      item.settings.ratio;

    info.append(small);
    row.append(info);

    const load =
      document.createElement("button");

    load.type = "button";
    load.textContent = "불러오기";

    load.onclick = () => {
      stopTemplateEditing();
      $("templateName").value = "";
      applyPersonalTemplate(item);
    };

    row.append(load);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "수정";
    edit.onclick = () => {
      applyPersonalTemplate(item);
      editingTemplateId = item.id;
      $("templateName").value = item.name;
      $("createTemplate").textContent = "수정 저장";
      cancelTemplateEdit.hidden = false;
      $("templateName").focus();
    };

    const actions = document.createElement("div");
    actions.className = "template-actions";
    actions.append(edit);

    const remove =
      document.createElement("button");

    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "삭제";

    remove.onclick = async () => {
      if (
        confirm(
          "이 템플릿을 삭제할까요?"
        )
      ) {
        await transaction(
          "readwrite",
          store => store.delete(item.id)
        );

        if (editingTemplateId === item.id) {
          stopTemplateEditing();
          $("templateName").value = "";
        }
        await renderTemplates();
      }
    };

    actions.append(remove);
    row.append(actions);
    list.append(row);
  }
}

$("createTemplate").onclick = async () => {
  if (!db) {
    alert(
      "브라우저 저장소를 사용할 수 없어요."
    );
    return;
  }

  const name =
    $("templateName").value.trim();

  if (!name) {
    alert(
      "템플릿 이름을 입력해 주세요."
    );
    return;
  }

  try {
    const thumbnail = await makePNG();

    saveSelectedText();

    const settings = {
      ...state,
      textItems: textItems.map(
        item => ({ ...item })
      )
    };

    await transaction(
      "readwrite",
      store => editingTemplateId === null
        ? store.add({ name, settings, thumbnail })
        : store.put({ id: editingTemplateId, name, settings, thumbnail })
    );

    stopTemplateEditing();
    $("templateName").value = "";

    await renderTemplates();

  } catch (error) {
    console.error(error);

    alert(
      "템플릿을 저장하지 못했어요. " +
      "브라우저 저장 공간을 확인해 주세요."
    );
  }
};

openDB()
  .then(database => {
    db = database;
    renderTemplates();
  })
  .catch(console.error);

renderTemplates().catch(console.error);

// 초기 상태 저장 및 UI 업데이트
saveState("초기 상태");
update();
updateUndoRedoButtons();