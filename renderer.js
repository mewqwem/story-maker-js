const { ipcRenderer } = require("electron");

// --- Глобальні змінні ---
let promptsData = {};

// --- Ініціалізація при завантаженні ---
document.addEventListener("DOMContentLoaded", async () => {
  // 1. Навігація по вкладках
  setupNavigation();

  // 2. Власний TitleBar
  setupTitleBar();

  // 3. Завантаження налаштувань користувача
  await loadUserSettings();

  // 4. Завантаження історії
  loadHistory();

  // 5. Події для кнопок
  bindActionButtons();
});

// --- Налаштування інтерфейсу ---

function setupNavigation() {
  const navBtns = document.querySelectorAll(".nav-btn");
  const pages = document.querySelectorAll(".page");

  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      // Remove active classes
      navBtns.forEach((b) => b.classList.remove("active"));
      pages.forEach((p) => p.classList.remove("active"));

      // Add active class
      btn.classList.add("active");
      const targetId = btn.getAttribute("data-target");
      document.getElementById(targetId).classList.add("active");

      // Якщо вкладка Історії - оновити список
      if (targetId === "page-history") loadHistory();
    });
  });
}

function setupTitleBar() {
  document
    .getElementById("minimize-btn")
    .addEventListener("click", () => ipcRenderer.send("minimize-window"));
  document
    .getElementById("maximize-btn")
    .addEventListener("click", () => ipcRenderer.send("maximize-window"));
  document
    .getElementById("close-btn")
    .addEventListener("click", () => ipcRenderer.send("close-window"));
}

function bindActionButtons() {
  // Вибір файлу промптів
  document
    .getElementById("btnSelectJson")
    .addEventListener("click", selectPromptFile);

  // Вибір папки
  document
    .getElementById("btnSelectOutput")
    .addEventListener("click", selectOutputFolder);

  // Старт генерації
  document.getElementById("btnStart").addEventListener("click", startProcess);

  // Налаштування
  document.getElementById("btnSaveKey").addEventListener("click", saveApiKey);
  document
    .getElementById("btnSaveEdgePath")
    .addEventListener("click", saveEdgeTtsPath);
  document
    .getElementById("btnToggleKey")
    .addEventListener("click", toggleApiKeyVisibility);

  // Логи
  document.getElementById("btnClearLogs").addEventListener("click", () => {
    document.getElementById("logsArea").innerHTML =
      '<div class="log-placeholder">Log cleared.</div>';
  });

  // Збереження змін в дропдаунах відразу
  document
    .getElementById("voice")
    .addEventListener("change", (e) => saveConfig("lastVoice", e.target.value));
  document
    .getElementById("language")
    .addEventListener("change", (e) =>
      saveConfig("lastLanguage", e.target.value)
    );
  document
    .getElementById("modelSelect")
    .addEventListener("change", (e) => saveConfig("lastModel", e.target.value));
}

// --- Логіка завантаження даних ---

async function loadUserSettings() {
  // API Key
  const key = await ipcRenderer.invoke("get-setting", "apiKey");
  if (key) document.getElementById("apiKeyInput").value = key;

  // Edge Path
  const edgeTtsPath = await ipcRenderer.invoke("get-setting", "edgeTtsPath");
  if (edgeTtsPath)
    document.getElementById("edgeTtsPathInput").value = edgeTtsPath;

  // Output Folder
  const savedOutputDir = await ipcRenderer.invoke("get-setting", "outputDir");
  if (savedOutputDir)
    document.getElementById("outputFolderDisplay").value = savedOutputDir;

  // Dropdowns
  const lastVoice = await ipcRenderer.invoke("get-setting", "lastVoice");
  if (lastVoice) document.getElementById("voice").value = lastVoice;

  const lastLang = await ipcRenderer.invoke("get-setting", "lastLanguage");
  if (lastLang) document.getElementById("language").value = lastLang;

  const lastModel = await ipcRenderer.invoke("get-setting", "lastModel");
  if (lastModel) document.getElementById("modelSelect").value = lastModel;

  // Prompt File (автозавантаження)
  const savedPromptPath = await ipcRenderer.invoke("get-setting", "promptPath");
  if (savedPromptPath) {
    loadPromptsFromFile(savedPromptPath);
  }

  // App Version
  const version = await ipcRenderer.invoke("get-version");
  document.getElementById("appVersion").innerText = version;
}

// --- Основний функціонал ---

async function selectPromptFile() {
  const path = await ipcRenderer.invoke("select-file");
  if (path) {
    saveConfig("promptPath", path);
    loadPromptsFromFile(path);
  }
}

async function loadPromptsFromFile(path) {
  const json = await ipcRenderer.invoke("read-json", path);
  if (json) {
    document.getElementById("promptFileDisplay").value = path;
    promptsData = json;
    const select = document.getElementById("promptSelect");
    select.innerHTML =
      '<option value="" disabled selected>— Оберіть шаблон —</option>';

    Object.keys(json).forEach((key) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.innerText = key;
      select.appendChild(opt);
    });

    // Автовибір другого елемента (якщо є) для зручності
    if (Object.keys(json).length > 0) {
      select.selectedIndex = 1;
    }
  } else {
    showToast("Помилка читання JSON файлу");
  }
}

async function selectOutputFolder() {
  const path = await ipcRenderer.invoke("select-folder");
  if (path) {
    document.getElementById("outputFolderDisplay").value = path;
    saveConfig("outputDir", path);
  }
}

async function startProcess() {
  // Валідація
  const projectName = document.getElementById("projectName").value;
  const title = document.getElementById("storyTitle").value;
  const templateKey = document.getElementById("promptSelect").value;
  const outputFolder = document.getElementById("outputFolderDisplay").value;

  if (!projectName || !title || !templateKey || !outputFolder) {
    alert("Будь ласка, заповніть всі поля та оберіть шаблон!");
    return;
  }

  // UI Update
  const btn = document.getElementById("btnStart");
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
  btn.disabled = true;

  // Clear logs
  const logsArea = document.getElementById("logsArea");
  logsArea.innerHTML = "";

  const data = {
    projectName,
    templateText: promptsData[templateKey],
    title,
    voice: document.getElementById("voice").value,
    language: document.getElementById("language").value,
    outputFolder,
    modelName: document.getElementById("modelSelect").value,
  };

  const result = await ipcRenderer.invoke("start-process", data);

  // Restore UI
  btn.innerHTML = originalText;
  btn.disabled = false;

  if (!result.success) {
    alert("Помилка: " + result.error);
  } else {
    showToast("Генерацію завершено успішно!");
  }
}

// --- Допоміжні функції ---

async function saveConfig(key, value) {
  await ipcRenderer.invoke("save-setting", key, value);
}

async function saveApiKey() {
  const key = document.getElementById("apiKeyInput").value;
  await saveConfig("apiKey", key);
  showStatusMessage("msgKeyStatus", "Збережено!");
}

async function saveEdgeTtsPath() {
  const path = document.getElementById("edgeTtsPathInput").value;
  await saveConfig("edgeTtsPath", path);
  showStatusMessage("msgEdgeStatus", "Збережено!");
}

function showStatusMessage(elementId, text) {
  const el = document.getElementById(elementId);
  el.innerText = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2000);
}

function toggleApiKeyVisibility() {
  const input = document.getElementById("apiKeyInput");
  const icon = document.getElementById("btnToggleKey");
  if (input.type === "password") {
    input.type = "text";
    icon.classList.replace("fa-eye", "fa-eye-slash");
  } else {
    input.type = "password";
    icon.classList.replace("fa-eye-slash", "fa-eye");
  }
}

function showToast(message) {
  const bar = document.getElementById("updateStatus");
  bar.innerText = message;
  bar.style.display = "block";

  // Автосховання
  setTimeout(() => {
    bar.style.display = "none";
  }, 4000);
}

// --- Логування ---
ipcRenderer.on("log-update", (event, msg) => {
  const logArea = document.getElementById("logsArea");

  // Видаляємо плейсхолдер
  const placeholder = logArea.querySelector(".log-placeholder");
  if (placeholder) placeholder.remove();

  const time = new Date().toLocaleTimeString("uk-UA", { hour12: false });
  const div = document.createElement("div");
  div.className = "log-entry";

  // Форматуємо
  let iconHTML = '<i class="fa-solid fa-info-circle"></i>';
  if (
    msg.toLowerCase().includes("помилка") ||
    msg.toLowerCase().includes("error")
  ) {
    div.classList.add("log-error");
    iconHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
  } else if (
    msg.toLowerCase().includes("готово") ||
    msg.toLowerCase().includes("успіх")
  ) {
    iconHTML = '<i class="fa-solid fa-check"></i>';
  }

  div.innerHTML = `<span class="log-time">[${time}]</span> ${iconHTML} ${msg}`;
  logArea.appendChild(div);
  logArea.scrollTop = logArea.scrollHeight;
});

// --- Історія ---
async function loadHistory() {
  const history = await ipcRenderer.invoke("get-history");
  const list = document.getElementById("historyList");
  list.innerHTML = "";

  if (history.length === 0) {
    list.innerHTML =
      "<p style='color:var(--text-muted); padding:10px;'>Історія поки що порожня.</p>";
    return;
  }

  history.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "history-item";
    div.style.animationDelay = `${index * 0.1}s`;

    div.innerHTML = `
            <h4>${item.title}</h4>
            <div class="history-meta">
                <span><i class="fa-regular fa-folder"></i> ${
                  item.projectName
                }</span>
                <span><i class="fa-regular fa-clock"></i> ${new Date(
                  item.timestamp
                ).toLocaleString()}</span>
            </div>
            <button class="btn-secondary btn-small" onclick="ipcRenderer.invoke('open-folder', '${item.path.replace(
              /\\/g,
              "\\\\"
            )}')">
                <i class="fa-solid fa-folder-open"></i> Відкрити папку
            </button>
        `;
    list.appendChild(div);
  });
}

// --- Логіка Оновлення (Auto-Updater) ---
ipcRenderer.on("show-update-modal", (event, version) => {
  const modal = document.getElementById("updateModal");
  const versionSpan = document.getElementById("newVersionSpan");

  // Перевірка на всяк випадок, якщо елементи не знайдено
  if (!modal || !versionSpan) return;

  versionSpan.innerText = `v${version}`;
  modal.classList.add("show");

  // Кнопка "Потім"
  document.getElementById("btnUpdateLater").onclick = () => {
    modal.classList.remove("show");
  };

  // Кнопка "Оновити"
  document.getElementById("btnUpdateNow").onclick = () => {
    modal.classList.remove("show");
    showToast("Завантаження оновлення розпочато...");
    ipcRenderer.send("confirm-update");
  };
});
