const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { exec } = require("child_process");
const { promisify } = require("util");
const Store = require("electron-store");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");

// Логування
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = "info";
log.info("App starting...");

const execPromise = promisify(exec);
const store = new Store();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#121417",
    icon: path.join(__dirname, "assets", "icon.ico"),
    frame: false, // Без рамки
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: true, // Можна вимкнути для продакшена
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadFile("index.html");

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    autoUpdater.checkForUpdatesAndNotify();
  });
}

app.whenReady().then(createWindow);

// --- Window Controls ---
ipcMain.on("minimize-window", () => mainWindow.minimize());
ipcMain.on("maximize-window", () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("close-window", () => mainWindow.close());

// --- Auto Updater ---
function sendStatusToWindow(text) {
  log.info(text);
  if (mainWindow) {
    mainWindow.webContents.send("update-message", text);
  }
}

autoUpdater.on("checking-for-update", () =>
  sendStatusToWindow("Перевірка оновлень...")
);
autoUpdater.on("update-available", () =>
  sendStatusToWindow("Знайдено нову версію. Завантаження...")
);
autoUpdater.on("update-not-available", () =>
  sendStatusToWindow("У вас найновіша версія.")
);
autoUpdater.on("error", (err) => sendStatusToWindow("Помилка: " + err));
autoUpdater.on("download-progress", (progressObj) => {
  sendStatusToWindow("Завантаження: " + Math.round(progressObj.percent) + "%");
});
autoUpdater.on("update-downloaded", () => {
  sendStatusToWindow("Завантажено. Перезапуск...");
  autoUpdater.quitAndInstall();
});

// --- Settings ---
ipcMain.handle("get-setting", (event, key) => store.get(key, null));
ipcMain.handle("save-setting", (event, key, value) => {
  store.set(key, value);
  return true;
});

// --- Generation Logic ---
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
    const apiKey = store.get("apiKey");
    if (!apiKey) throw new Error("API ключ відсутній в налаштуваннях.");

    const edgeTtsPath = store.get("edgeTtsPath");
    if (!edgeTtsPath) throw new Error("Шлях до Edge TTS відсутній.");

    const genAI = new GoogleGenerativeAI(apiKey);
    const selectedModel = modelName || "gemini-2.0-flash";

    sendLog(`Початок проекту: ${projectName}`);
    sendLog(`Модель: ${selectedModel}`);

    // 1. Папка
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const folderName = `${projectName}_${timestamp}`;
    const finalPath = path.join(outputFolder, folderName);
    await fs.ensureDir(finalPath);

    // 2. Історія
    const model = genAI.getGenerativeModel({ model: selectedModel });
    const chat = model.startChat({ history: [] });

    sendLog("Генерація історії...");
    let finalPrompt = templateText
      .replace("{TITLE}", title)
      .replace("{LANGUAGE}", language);
    let fullStory = "";
    let currentMsg = finalPrompt;
    let part = 1;

    while (true) {
      sendLog(`Генерація частини ${part}...`);
      const result = await chat.sendMessage(currentMsg);
      let text = result.response.text();
      let isEnd = text.includes("END");
      if (isEnd) text = text.replace("END", "");

      // Очищення
      text = text
        .replace(/^\*\*Title\*\*:.*$/gim, "")
        .replace(/{LANGUAGE}/g, "")
        .replace(
          /Type ['"‘`]?Continue['"’`]? to receive the next part\.?/gi,
          ""
        )
        .trim();

      if (text) fullStory += text + "\n\n";
      if (isEnd || part >= 30) break;

      await sleep(2000); // Зменшив паузу для швидкості
      currentMsg = "Continue";
      part++;
    }

    const storyPath = path.join(finalPath, "story.txt");
    await fs.writeFile(storyPath, fullStory);
    sendLog("Історію збережено.");

    // 3. Опис
    sendLog("Генерація опису (YouTube SEO)...");
    await sleep(2000);
    // Тут скорочений промпт для прикладу, використовуй свій повний
    const descPrompt = `Create a YouTube description for: ${title}. Language: English.`;
    const descResult = await chat.sendMessage(descPrompt);
    await fs.writeFile(
      path.join(finalPath, "description.txt"),
      descResult.response.text()
    );
    sendLog("Опис збережено.");

    // 4. Озвучка
    sendLog(`Створення аудіо (${voice})...`);
    const audioPath = path.join(finalPath, "audio.mp3");
    const tempTextPath = path.join(finalPath, "temp_tts.txt");
    const cleanTextForAudio = fullStory
      .replace(/\*/g, "")
      .replace(/[""]/g, "'");

    await fs.writeFile(tempTextPath, cleanTextForAudio);
    const command = `"${edgeTtsPath}" --file "${tempTextPath}" --write-media "${audioPath}" --voice ${voice}`;
    await execPromise(command);
    await fs.unlink(tempTextPath).catch(() => {});

    sendLog("Готово! Відкриваю папку.");
    shell.openPath(finalPath);

    // Save History
    const history = store.get("generationHistory", []);
    history.unshift({
      title,
      projectName,
      path: finalPath,
      timestamp: new Date().toISOString(),
    });
    if (history.length > 20) history.splice(20);
    store.set("generationHistory", history);

    return { success: true };
  } catch (error) {
    console.error(error);
    sendLog(`Критична помилка: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// --- Dialogs ---
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

ipcMain.handle("read-json", async (e, filePath) => {
  try {
    return await fs.readJson(filePath);
  } catch (err) {
    return null;
  }
});

ipcMain.handle("get-version", () => app.getVersion());
ipcMain.handle("get-history", () => store.get("generationHistory", []));
ipcMain.handle("open-folder", (e, p) => shell.openPath(p));
