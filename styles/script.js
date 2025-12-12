const { ipcRenderer } = require("electron");

let promptsData = {};

// === ІНІЦІАЛІЗАЦІЯ ПРИ ЗАПУСКУ ===
window.onload = async () => {
  // 1. Завантажуємо API ключ
  const key = await ipcRenderer.invoke("get-setting", "apiKey");
  if (key) document.getElementById("apiKeyInput").value = key;

  // 2. Завантажуємо шлях до prompts.json
  const savedPromptPath = await ipcRenderer.invoke("get-setting", "promptPath");
  if (savedPromptPath) {
    loadPromptsFromFile(savedPromptPath);
  }

  // 3. Завантажуємо папку виводу
  const savedOutputDir = await ipcRenderer.invoke("get-setting", "outputDir");
  if (savedOutputDir)
    document.getElementById("outputFolder").value = savedOutputDir;

  // 4. Відновлюємо вибір мови, голосу та моделі
  const lastVoice = await ipcRenderer.invoke("get-setting", "lastVoice");
  if (lastVoice) document.getElementById("voice").value = lastVoice;

  const lastLang = await ipcRenderer.invoke("get-setting", "lastLanguage");
  if (lastLang) document.getElementById("language").value = lastLang;

  const lastModel = await ipcRenderer.invoke("get-setting", "lastModel");
  if (lastModel) document.getElementById("modelSelect").value = lastModel;
};

// === ЛОГІКА ЗБЕРЕЖЕННЯ НАЛАШТУВАНЬ ===
async function saveConfig(key, value) {
  await ipcRenderer.invoke("save-setting", key, value);
}

async function saveApiKey() {
  const key = document.getElementById("apiKeyInput").value;
  await saveConfig("apiKey", key);
  const status = document.getElementById("saveStatus");
  status.style.display = "block";
  setTimeout(() => (status.style.display = "none"), 3000);
}

// === РОБОТА З ФАЙЛАМИ ===

// Вибір JSON файлу промптів
async function selectFile() {
  const path = await ipcRenderer.invoke("select-file");
  if (path) {
    loadPromptsFromFile(path);
    // Зберігаємо шлях, щоб наступного разу не шукати
    saveConfig("promptPath", path);
  }
}

// Читання та парсинг JSON
async function loadPromptsFromFile(path) {
  const json = await ipcRenderer.invoke("read-json", path);
  if (json) {
    document.getElementById("promptFile").value = path;
    promptsData = json;
    const select = document.getElementById("promptSelect");
    select.innerHTML = "";

    Object.keys(json).forEach((key) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.innerText = key;
      select.appendChild(opt);
    });
  } else {
    alert("Не вдалося прочитати файл або він порожній!");
  }
}

// Вибір папки для результатів
async function selectFolder() {
  const path = await ipcRenderer.invoke("select-folder");
  if (path) {
    document.getElementById("outputFolder").value = path;
    saveConfig("outputDir", path);
  }
}

// === ЗАПУСК ===
async function startProcess() {
  const logsDiv = document.getElementById("logs");
  logsDiv.innerHTML = "Запуск...<br>";

  const data = {
    projectName: document.getElementById("projectName").value,
    templateText: promptsData[document.getElementById("promptSelect").value],
    title: document.getElementById("storyTitle").value,
    voice: document.getElementById("voice").value,
    language: document.getElementById("language").value,
    outputFolder: document.getElementById("outputFolder").value,
    modelName: document.getElementById("modelSelect").value,
  };

  if (!data.outputFolder || !data.templateText) {
    alert("Заповніть поля та оберіть файл промптів!");
    return;
  }

  const res = await ipcRenderer.invoke("start-process", data);
  if (!res.success) alert("Помилка: " + res.error);
}

// === ІНТЕРФЕЙС ===
function showPage(pageName) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".sidebar-btn")
    .forEach((b) => b.classList.remove("active"));
  document.getElementById(`page-${pageName}`).classList.add("active");

  const btnIndex = pageName === "generator" ? 0 : 1;
  document.querySelectorAll(".sidebar-btn")[btnIndex].classList.add("active");
}

function toggleApiKeyVisibility() {
  const input = document.getElementById("apiKeyInput");
  const icon = document.querySelector(".toggle-password");
  if (input.type === "password") {
    input.type = "text";
    icon.classList.remove("fa-eye");
    icon.classList.add("fa-eye-slash");
  } else {
    input.type = "password";
    icon.classList.remove("fa-eye-slash");
    icon.classList.add("fa-eye");
  }
}

// Логи та Оновлення
ipcRenderer.on("log-update", (e, msg) => {
  const logs = document.getElementById("logs");
  logs.innerHTML += `> ${msg}<br>`;
  logs.scrollTop = logs.scrollHeight;
});

ipcRenderer.on("update-message", (e, text) => {
  const bar = document.getElementById("updateStatus");
  bar.innerText = text;
  bar.style.display = "block";
});
