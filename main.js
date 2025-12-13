const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { exec } = require("child_process");
const { promisify } = require("util");
const Store = require("electron-store");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");

// Налаштування логування для авто-апдейтера
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = "info";
log.info("App starting...");

const execPromise = promisify(exec);
const store = new Store();

// Допоміжна функція паузи
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    backgroundColor: "#1e1e1e",
    icon: path.join(__dirname, "icon.ico"),
    frame: false, // Вимикаємо стандартний заголовок
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadFile("index.html");

  // Перевірка оновлень після запуску вікна
  mainWindow.once("ready-to-show", () => {
    autoUpdater.checkForUpdatesAndNotify();
  });
}

app.whenReady().then(createWindow);

// Обробники для власного заголовка
ipcMain.on("minimize-window", () => {
  mainWindow.minimize();
});

ipcMain.on("maximize-window", () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on("close-window", () => {
  mainWindow.close();
});

// === ЛОГІКА АВТО-ОНОВЛЕННЯ ===

// Відправляє повідомлення на фронтенд
function sendStatusToWindow(text) {
  log.info(text);
  if (mainWindow) {
    mainWindow.webContents.send("update-message", text);
  }
}

autoUpdater.on("checking-for-update", () => {
  sendStatusToWindow("Перевірка оновлень...");
});
autoUpdater.on("update-available", (info) => {
  sendStatusToWindow("Знайдено нову версію! Завантажую...");
});
autoUpdater.on("update-not-available", (info) => {
  sendStatusToWindow("У вас найновіша версія.");
});
autoUpdater.on("error", (err) => {
  sendStatusToWindow("Помилка оновлення: " + err);
});
autoUpdater.on("download-progress", (progressObj) => {
  let log_message = "Завантаження: " + Math.round(progressObj.percent) + "%";
  sendStatusToWindow(log_message);
});
autoUpdater.on("update-downloaded", (info) => {
  sendStatusToWindow("Оновлення завантажено. Перезапуск...");
  // Запитуємо користувача або просто перезапускаємо
  dialog
    .showMessageBox({
      type: "info",
      title: "Оновлення готове",
      message:
        "Нова версія завантажена. Програма перезапуститься для встановлення.",
      buttons: ["ОК"],
    })
    .then(() => {
      autoUpdater.quitAndInstall();
    });
});

// === НАЛАШТУВАННЯ (ЗБЕРЕЖЕННЯ ДАНИХ) ===

// Універсальна функція для отримання налаштувань
ipcMain.handle("get-setting", (event, key) => {
  return store.get(key, null);
});

// Універсальна функція для збереження налаштувань
ipcMain.handle("save-setting", (event, key, value) => {
  store.set(key, value);
  return true;
});

// === ЛОГІКА ГЕНЕРАЦІЇ ===

ipcMain.handle("start-process", async (event, data) => {
  const {
    projectName,
    templateText,
    title,
    voice,
    language,
    outputFolder,
    modelName,
  } = data;

  const sendLog = (msg) => mainWindow.webContents.send("log-update", msg);

  try {
    // ОТРИМУЄМО КЛЮЧ ЗІ СХОВИЩА, А НЕ З .ENV
    const apiKey = store.get("apiKey");
    if (!apiKey)
      throw new Error("API ключ не знайдено! Введіть його в налаштуваннях.");

    // ОТРИМУЄМО ШЛЯХ ДО EDGE TTS ЗІ СХОВИЩА
    const edgeTtsPath = store.get("edgeTtsPath");
    if (!edgeTtsPath)
      throw new Error(
        "Шлях до Edge TTS не вказано! Введіть його в налаштуваннях."
      );

    const genAI = new GoogleGenerativeAI(apiKey);

    const selectedModel = modelName || "gemini-2.0-flash";

    sendLog(`🚀 Починаю проект: ${projectName}`);
    sendLog(`🧠 Використовую модель: ${selectedModel}`);

    // 1. Створення папки
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const folderName = `${projectName}_${timestamp}`;
    const finalPath = path.join(outputFolder, folderName);
    await fs.ensureDir(finalPath);

    // 2. Ініціалізація Gemini
    const model = genAI.getGenerativeModel({ model: selectedModel });
    const chat = model.startChat({ history: [] });

    // 3. Генерація Історії
    sendLog("🤖 Gemini пише історію...");

    let finalPrompt = templateText
      .replace("{TITLE}", title)
      .replace("{LANGUAGE}", language);

    let fullStory = "";
    let currentMsg = finalPrompt;
    let part = 1;

    while (true) {
      sendLog(`✍️ Генерація частини ${part}...`);

      const result = await chat.sendMessage(currentMsg);
      let text = result.response.text();

      let isEnd = false;
      if (text.includes("END")) {
        text = text.replace("END", "");
        isEnd = true;
      }

      // === ОЧИЩЕННЯ ТЕКСТУ ===
      text = text.replace(/^\*\*Title\*\*:.*$/gim, "");
      text = text.replace(/{LANGUAGE}/g, "");
      text = text.replace(
        /Type ['"‘`]?Continue['"’`]? to receive the next part\.?/gi,
        ""
      );
      text = text.trim();

      if (text) fullStory += text + "\n\n";
      if (isEnd || part >= 30) break;

      sendLog(`⏳ Пауза 5 сек...`);
      await sleep(5000);
      currentMsg = "Continue";
      part++;
    }

    const storyPath = path.join(finalPath, "story.txt");
    await fs.writeFile(storyPath, fullStory);
    sendLog("✅ Історія збережена.");

    // 4. Опис
    sendLog(`⏳ Пауза 60 сек перед описом...`);
    await sleep(5000); // Тестова затримка, зміни на 60000 для продакшена

    sendLog("📝 Gemini пише опис...");
    const descPrompt = `
        Звісно, ось переписаний промпт англійською мовою, який відповідає всім твоїм вимогам:

You are an expert YouTube SEO copywriter for the Carl Jung / depth psychology / female empowerment niche.

Your task is to write a highly clickable and SEO-optimized video description (380–550 words) that perfectly matches the core style rules and structure outlined below. The content must be based on the specific video topic and story you provided previously (insert the topic and story in place of the brackets below).

Video Topic: [Insert the main video topic here, e.g., The Shadow Side of Anima, The Archetype of the Hetaera, Female Loneliness] Brief Story/Context: [Insert a short summary of the story or the main points discussed in the video here]

Core Style Rules (Must be followed exactly):

First 2–3 lines (visible before “Show more”): The strongest emotional hook + main keyword in the very first sentence.

Example: "Many believe that not having friends is a weakness, but the truth is quite different..."

Tone:

Deep but simple, never academic.

Slightly mysterious, empowering, speaks directly to women who are “waking up.”

Formatting:

Short paragraphs (2–4 sentences max).

Heavy use of second-person ("you," "your," "do you feel").

Ends most paragraphs with a subtle question or realization.

Exact Structure:

Hook: 1–2 sentences, visible before “Show more.”

Core Idea: 4–6 short paragraphs explaining the main idea + what the viewer will discover.

Q&A Paragraph: 1 paragraph with 2–3 questions the video answers (e.g., "In this video, we dive deep into: ...").

Soft CTA: Gentle call-to-action + "Thank you for watching."

Hashtags Section: 38–50 relevant hashtags, lower-case, no spaces after the comma (e.g.: #carljung,#depthpsychology,#shadowwork).

Search Terms Section: 40–60 real search phrases related to the topic (each on a new line).

Final CTA: Gentle call to comments (e.g.: "Thank you for watching! Let me know in the comments which part hit you the hardest..." or similar).
    `; // Скоротив тут для економії місця, встав свій повний промпт

    const descResult = await chat.sendMessage(descPrompt);
    const descPath = path.join(finalPath, "description.txt");
    await fs.writeFile(descPath, descResult.response.text());
    sendLog("✅ Опис збережено.");

    // 5. Озвучка
    sendLog(`🎙️ Озвучка (${voice})...`);
    const audioPath = path.join(finalPath, "audio.mp3");
    const tempTextPath = path.join(finalPath, "temp_tts.txt");

    const cleanTextForAudio = fullStory
      .replace(/\*/g, "")
      .replace(/[""]/g, "'");
    await fs.writeFile(tempTextPath, cleanTextForAudio);

    // ВИКОРИСТОВУЄМО ШЛЯХ ЗІ ЗМІННОЇ, А НЕ КОНСТАНТИ
    const command = `"${edgeTtsPath}" --file "${tempTextPath}" --write-media "${audioPath}" --voice ${voice}`;
    await execPromise(command);
    await fs.unlink(tempTextPath).catch(() => {});

    sendLog("✨ Все готово! Відкриваю папку.");
    shell.openPath(finalPath);

    return { success: true };
  } catch (error) {
    console.error(error);
    sendLog(`❌ ПОМИЛКА: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// --- ДІАЛОГИ ---
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.filePaths[0];
});

ipcMain.handle("select-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  return result.filePaths[0];
});

ipcMain.handle("read-json", async (event, filePath) => {
  try {
    return await fs.readJson(filePath);
  } catch (e) {
    return null;
  }
});

// Динамічна версія
ipcMain.handle("get-version", () => {
  return app.getVersion();
});
