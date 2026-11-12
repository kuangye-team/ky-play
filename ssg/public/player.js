let language = "zh";
const playerText = (chinese, english) =>
  language === "en" ? english : chinese;
/* Isolated EmulatorJS lifecycle: a new iframe releases every core and audio context. */
let initialized = false;
let desktopGameId = null;
const send = (type, payload = {}) =>
  parent.postMessage(
    { source: "shiguang-player", type, ...payload },
    location.origin,
  );
let initTimer;
// Opening the screenshot dialog also pauses the player. Defer that pause until
// EmulatorJS has rendered and copied the frame, then honor the latest request.
let capturingFrame = false;
let pauseAfterCapture = false;
async function captureScreenshot(emulator) {
  pauseAfterCapture = emulator.paused;
  capturingFrame = true;
  let timer;
  try {
    if (emulator.paused) emulator.play();
    // The N64 core's native screenshot does not preserve the rendered colors.
    // EmulatorJS's canvas capture reads the displayed WebGL frame instead.
    const picture =
      emulator.getCore() === "mupen64plus_next"
        ? new Promise((resolve, reject) => {
            emulator.screenshot(
              (blob) => {
                if (!blob)
                  return reject(
                    new Error(
                      playerText("截图失败", "Could not take a screenshot."),
                    ),
                  );
                blob
                  .arrayBuffer()
                  .then((data) => resolve(new Uint8Array(data)), reject);
              },
              "canvas",
              "png",
              1,
            );
          })
        : emulator.gameManager.screenshot();
    return await Promise.race([
      picture,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), 2500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    capturingFrame = false;
    if (pauseAfterCapture) emulator.pause();
  }
}
window.addEventListener("message", async (event) => {
  if (
    event.origin !== location.origin ||
    event.source !== parent ||
    event.data?.source !== "shiguang-app"
  )
    return;
  const { type, config, id, payload } = event.data;
  if (type === "init" && !initialized) {
    initialized = true;
    desktopGameId = config.desktop ? config.id : null;
    language = config.language === "en" ? "en" : "zh";
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    document.title = playerText("游戏画面", "Game screen");
    const performance = playerPerformance(config.core);
    if (config.core === "ppsspp" && !performance.threads) {
      send("error", {
        message: playerText(
          "当前页面暂时无法运行 PSP 游戏，请通过安全网址打开后重试。",
          "PSP games cannot run on this page. Open a secure address and try again.",
        ),
      });
      return;
    }
    let gameFile, biosFile;
    try {
      gameFile = new File(
        [await (await fetch(config.url)).blob()],
        config.filename,
      );
      if (config.biosUrl)
        biosFile = new File(
          [await (await fetch(config.biosUrl)).blob()],
          config.biosFilename,
        );
    } catch {
      send("error", {
        message: playerText(
          "游戏文件读取失败，请重新打开。",
          "Could not read the game file. Please reopen the game.",
        ),
      });
      return;
    }
    Object.assign(window, {
      EJS_player: "#game",
      EJS_core: config.core,
      EJS_threads: performance.threads,
      EJS_controlScheme: config.controlScheme,
      EJS_gameUrl: gameFile,
      EJS_biosUrl: biosFile,
      EJS_gameName: config.id,
      EJS_gameID: config.numericId,
      EJS_pathtodata: config.emulatorBaseUrl,
      EJS_startOnLoaded: false,
      EJS_language: language === "en" ? "en-US" : "zh-CN",
      EJS_color: "#7358f6",
      EJS_backgroundColor: "#17182b",
      EJS_volume: 0.5,
      EJS_disableLocalStorage: true,
      EJS_noAutoFocus: true,
      EJS_defaultOptions: performance.defaultOptions,
      EJS_Buttons: {
        playPause: false,
        restart: false,
        saveState: false,
        loadState: false,
        gamepad: false,
        cheat: false,
        volume: false,
        settings: false,
        fullscreen: false,
        saveSavFiles: false,
        loadSavFiles: false,
        quickSave: false,
        quickLoad: false,
        screenshot: false,
        cacheManager: false,
        exitEmulation: false,
        contextMenu: false,
        screenRecord: false,
        netplay: false,
        rightClick: false,
      },
      EJS_ready: () => {
        preferPerformanceGraphics(window.EJS_emulator.canvas);
        // The parent owns keyboard, touch and gamepad input for one consistent mapping.
        window.EJS_emulator.gamepad?.terminate();
        window.EJS_emulator.on("saveDatabaseLoaded", (fs) => {
          const path = `/data/saves/${config.id}`;
          if (!fs.analyzePath(path).exists) fs.mkdir(path);
          const settingsPath = "/home/web_user/.config/retroarch/retroarch.cfg";
          let settings = fs.readFile(settingsPath, { encoding: "utf8" });
          // 4.2.3 does not accept EJS_retroarchOpts. Apply our settings before
          // the core reads retroarch.cfg, together with the per-game save path.
          for (const [key, value] of Object.entries({ ...performance.retroarchOpts, savefile_directory: path })) {
            settings = settings.replace(new RegExp(`^${key}\\s*=.*$`, "gm"), "");
            settings += `\n${key} = ${JSON.stringify(value)}\n`;
          }
          fs.writeFile(settingsPath, settings);
        });
        // Install the save-directory hook before the core can begin loading.
        document.querySelector(".ejs_start_button")?.click();
      },
      EJS_onGameStart: () => {
        clearTimeout(initTimer);
        send("ready");
      },
    });
    initTimer = setTimeout(
      () =>
        send("error", {
          message: playerText(
            "游戏加载时间有点长，请重试或换一个游戏文件。",
            "The game is taking too long to load. Try again or choose another game file.",
          ),
        }),
      120000,
    );
    try {
      await loadEmulator(config);
    } catch (error) {
      clearTimeout(initTimer);
      console.error("Emulator loading failed", error);
      send("error", {
        message: playerText(
          "游戏没有加载成功，请重新打开。",
          "Could not load the game. Please reopen it.",
        ),
      });
    }
    return;
  }
  if (type === "command") {
    try {
      const e = window.EJS_emulator;
      if (!e?.gameManager)
        throw new Error(
          playerText("游戏还没有准备好。", "The game is not ready yet."),
        );
      let result;
      switch (payload.action) {
        case "input":
          e.gameManager.simulateInput(0, payload.index, payload.value);
          break;
        case "pause":
          if (capturingFrame) pauseAfterCapture = true;
          else e.pause();
          break;
        case "resume":
          if (capturingFrame) pauseAfterCapture = false;
          else e.play();
          break;
        case "restart":
          e.gameManager.restart();
          break;
        case "volume":
          e.setVolume(payload.value);
          break;
        case "load":
          e.gameManager.loadState(new Uint8Array(payload.data));
          break;
        case "screenshot": {
          const screenshot = await captureScreenshot(e);
          if (!screenshot?.length)
            throw new Error(
              playerText("截图失败", "Could not take a screenshot."),
            );
          result = new Uint8Array(screenshot);
          break;
        }
        case "save": {
          e.gameManager.saveSaveFiles();
          await new Promise((resolve, reject) =>
            e.gameManager.FS.syncfs(false, (error) =>
              error ? reject(error) : resolve(),
            ),
          );
          const data = e.gameManager.getState();
          if (!data?.length)
            throw new Error(
              playerText(
                "暂时无法保存，请稍后再试。",
                "Could not save. Please try again later.",
              ),
            );
          const screenshot = await captureScreenshot(e).catch(() => null);
          const nativeFiles = [];
          if (desktopGameId) {
            const fs = e.gameManager.FS;
            const visit = (directory) => {
              for (const name of fs.readdir(directory)) {
                if (name === "." || name === "..") continue;
                const path = `${directory}/${name}`;
                const stat = fs.stat(path);
                if (fs.isDir(stat.mode)) visit(path);
                else if (fs.isFile(stat.mode)) nativeFiles.push({ path, created: Number(stat.mtime), data: new Uint8Array(fs.readFile(path)) });
              }
            };
            visit(`/data/saves/${desktopGameId}`);
          }
          result = {
            ...(desktopGameId ? { nativeFiles } : {}),
            data: new Uint8Array(data),
            screenshot: screenshot ? new Uint8Array(screenshot) : null,
          };
          break;
        }
      }
      if (id) send("response", { id, result });
    } catch (error) {
      console.error("Player command failed", payload.action, error);
      if (id)
        send("response", {
          id,
          error: playerText(
            "操作没有完成，请稍后重试。",
            "That did not work. Please try again later.",
          ),
        });
    }
  }
});
// One keyboard path in the parent prevents the emulator's defaults from firing twice.
for (const type of ["keydown", "keyup"])
  window.addEventListener(
    type,
    (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      send("key", {
        code: event.code,
        down: type === "keydown",
        repeat: event.repeat,
      });
    },
    true,
  );
window.addEventListener("blur", () => send("blur"));
window.addEventListener("error", (event) =>
  send("error", {
    message: playerText(
      "游戏运行遇到问题，请重新打开。",
      "The game ran into a problem. Please reopen it.",
    ),
  }),
);
