const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { exec } = require("child_process");
const { promisify } = require("util");
require("dotenv").config();

const execPromise = promisify(exec);

// === КОНСТАНТИ ТА НАЛАШТУВАННЯ ===
const EDGE_TTS_PATH = String.raw`C:\Users\roadt\AppData\Roaming\Python\Python314\Scripts\edge-tts.exe`;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Ініціалізація API
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

// Допоміжна функція для паузи (sleep)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadFile("index.html");
}

app.whenReady().then(createWindow);

// === ЛОГІКА ГЕНЕРАЦІЇ ===

ipcMain.handle("start-process", async (event, data) => {
  const {
    projectName,
    templateText,
    title,
    voice,
    language,
    outputFolder,
    modelName, // Отримуємо назву моделі з фронтенду
  } = data;

  const sendLog = (msg) => mainWindow.webContents.send("log-update", msg);

  try {
    if (!GOOGLE_API_KEY) throw new Error("Немає GOOGLE_API_KEY в .env файлі!");

    // Використовуємо модель, яку вибрали, або ставимо дефолтну
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

    // 2. Ініціалізація Gemini з обраною моделлю
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

      // 1. Видаляємо рядок із заголовком (наприклад: **Title**: ...)
      text = text.replace(/^\*\*Title\*\*:.*$/gim, "");

      // 2. Видаляємо {LANGUAGE}, якщо він залишився
      text = text.replace(/{LANGUAGE}/g, "");

      // 3. Видаляємо фразу "Type Continue..." (з будь-якими лапками)
      text = text.replace(
        /Type ['"‘`]?Continue['"’`]? to receive the next part\.?/gi,
        ""
      );

      // 4. Прибираємо зайві пробіли по краях
      text = text.trim();

      // Додаємо до загальної історії, якщо текст не пустий
      if (text) {
        fullStory += text + "\n\n";
      }

      if (isEnd || part >= 30) break;

      // Пауза 5 секунд між частинами, щоб не перевантажувати
      sendLog(`⏳ Пауза 5 сек...`);
      await sleep(5000);

      currentMsg = "Continue";
      part++;
    }

    // Зберігаємо історію
    const storyPath = path.join(finalPath, "story.txt");
    await fs.writeFile(storyPath, fullStory);
    sendLog("✅ Історія збережена.");

    // 4. Генерація Опису
    sendLog(`⏳ Пауза 60 сек перед описом (ліміти API)...`);
    await sleep(5000); // Чекаємо 5 сек (в оригіналі було 5000, хоча лог пише 60 сек)

    sendLog("📝 Gemini пише опис...");

    const descPrompt = `
        Now, based strictly on the story you just generated in our conversation, write a highly clickable and SEO-optimized YouTube video description.
        
        You are an expert YouTube SEO copywriter for the Carl Jung / depth psychology / female empowerment niche.
        Your task is to write a 380–550-word description that perfectly matches the style of top competitors.

        Core style rules (must follow exactly):
        1. First 2–3 lines (visible before “Show more”) = strongest emotional hook + main keyword in the first sentence.
           Example: “Many believe that not having friends is a weakness, but the truth is quite different…”
        
        2. Tone:
           - Deep but simple, never academic.
           - Slightly mysterious, empowering, speaks directly to women who are “waking up”.
           - Heavy use of second-person (“you”).
        
        3. Structure & Formatting:
           - Short paragraphs (2–4 sentences max).
           - End most paragraphs with a subtle question or realization.
           - HOOK (1–2 sentences).
           - BODY (4–6 short paragraphs explaining the core idea + what the viewer will discover).
           - QUESTIONS (1 paragraph with 2–3 questions the video answers).
           - Soft CTA + “Thank you for watching”.
           - HASHTAGS section (38–50 relevant, lower-case, no spaces after comma).
           - SEARCH TERMS section (40–60 real search phrases, comma-separated).
           - FINAL CTA: gentle (“Thank you for watching! Let me know in the comments which part hit you the hardest…”).
        `;

    const descResult = await chat.sendMessage(descPrompt);
    const descText = descResult.response.text();

    const descPath = path.join(finalPath, "description.txt");
    await fs.writeFile(descPath, descText);
    sendLog("✅ Опис збережено.");

    // 5. Озвучка (Edge TTS)
    sendLog(`🎙️ Озвучка (${voice})...`);
    const audioPath = path.join(finalPath, "audio.mp3");
    const tempTextPath = path.join(finalPath, "temp_tts.txt");

    // Чистимо текст для TTS
    const cleanTextForAudio = fullStory
      .replace(/\*/g, "")
      .replace(/[""]/g, "'");
    await fs.writeFile(tempTextPath, cleanTextForAudio);

    const command = `"${EDGE_TTS_PATH}" --file "${tempTextPath}" --write-media "${audioPath}" --voice ${voice}`;
    await execPromise(command);

    // Видаляємо тимчасовий файл
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
    if (fs.existsSync(filePath)) {
      return await fs.readJson(filePath);
    }
    return null;
  } catch (e) {
    return null;
  }
});
