const { ipcRenderer } = require("electron");
const path = require("path");

let selectedFolder = path.join(
  process.env.USERPROFILE || process.env.HOME,
  "Desktop"
);
let promptsData = {};
let promptJsonPath = "prompts.json"; // Дефолтний шлях

// Оновлення логу
ipcRenderer.on("log-update", (event, msg) => {
  const logArea = document.getElementById("logArea");
  const time = new Date().toLocaleTimeString();
  logArea.innerHTML += `<div>[${time}] ${msg}</div>`;
  logArea.scrollTop = logArea.scrollHeight;
});

// Перемикання вкладок
function switchTab(tab) {
  const storyDiv = document.getElementById("storyContent");
  const rewriteDiv = document.getElementById("rewriteContent");
  const btnStory = document.getElementById("tabStory");
  const btnRewrite = document.getElementById("tabRewrite");

  if (tab === "story") {
    storyDiv.style.display = "block";
    rewriteDiv.style.display = "none";
    btnStory.className = "tab-btn active";
    btnRewrite.className = "tab-btn inactive";
  } else {
    storyDiv.style.display = "none";
    rewriteDiv.style.display = "block";
    btnStory.className = "tab-btn inactive";
    btnRewrite.className = "tab-btn active";
  }
}

// Вибір папки
async function chooseFolder() {
  const path = await ipcRenderer.invoke("select-folder");
  if (path) {
    selectedFolder = path;
    document.getElementById(
      "folderPathDisplay"
    ).innerText = `Output: ${selectedFolder}`;
  }
}

// Пошук JSON
async function findPromptJson() {
  const path = await ipcRenderer.invoke("select-file");
  if (path) {
    promptJsonPath = path;
    loadPrompts(path);
  }
}

// Завантаження промптів
async function loadPrompts(filePath) {
  const data = await ipcRenderer.invoke("read-json", filePath);
  const select = document.getElementById("templateSelect");

  // Якщо елемента немає (наприклад, ще не завантажився), виходимо
  if (!select) return;

  select.innerHTML =
    '<option value="" disabled selected>Select template...</option>';

  if (data) {
    promptsData = data;
    Object.keys(data).forEach((key) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.innerText = key;
      select.appendChild(opt);
    });
    // Вибираємо перший автоматично
    if (Object.keys(data).length > 0) {
      select.selectedIndex = 1;
    }
  } else {
    alert("Не вдалося прочитати JSON або файл порожній.");
  }
}

// СТАРТ
async function startQueue() {
  const projectName = document.getElementById("projectName").value;
  const templateKey = document.getElementById("templateSelect").value;
  const title = document.getElementById("titleInput").value;
  const voice = document.getElementById("voiceSelect").value;
  const language = document.getElementById("langSelect").value;

  // === НОВЕ: Зчитуємо модель ===
  const modelSelect = document.getElementById("modelSelect");
  // Якщо елемент є, беремо значення, якщо ні — дефолт
  const modelName = modelSelect ? modelSelect.value : "gemini-2.0-flash";

  if (!projectName || !title || !templateKey) {
    alert("Будь ласка, заповніть всі поля (Project Name, Template, Title)!");
    return;
  }

  const templateText = promptsData[templateKey];

  // Блокуємо кнопку
  const btn = document.querySelector(".btn-green");
  const oldText = btn.innerText;
  btn.innerText = "⏳ PROCESSING...";
  btn.disabled = true;
  btn.style.backgroundColor = "#555";

  const data = {
    projectName,
    templateText,
    title,
    voice,
    language,
    outputFolder: selectedFolder,
    promptJsonPath,
    modelName, // Передаємо вибрану модель в main.js
  };

  const result = await ipcRenderer.invoke("start-process", data);

  // Розблокуємо
  btn.innerText = oldText;
  btn.disabled = false;
  btn.style.backgroundColor = "#1b8e38";

  if (!result.success) {
    alert("Помилка: " + result.error);
  }
}

// Прив'язка подій після завантаження сторінки
document.addEventListener("DOMContentLoaded", () => {
  // При старті пробуємо завантажити prompts.json, якщо він лежить поруч
  loadPrompts("prompts.json");

  // Можна додати слухач для кнопки старт тут, якщо його немає в HTML
  // document.getElementById("startBtn").addEventListener("click", startQueue);
});
