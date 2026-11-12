/* Load the unmodified 4.2.3 release with CORS, including its classic JS and CSS.
 * Upstream loader.js creates no-CORS tags, which COEP blocks on a separate CDN.
 */
async function loadEmulator(config) {
  const base = new URL(window.EJS_pathtodata, location.origin);
  const load = (file, stylesheet = false) => new Promise((resolve, reject) => {
    const element = document.createElement(stylesheet ? "link" : "script");
    element.crossOrigin = "anonymous";
    if (stylesheet) {
      element.rel = "stylesheet";
      element.href = new URL(file, base).href;
    } else {
      element.src = new URL(file, base).href;
    }
    element.onload = resolve;
    element.onerror = () => reject(new Error(`Could not load ${file}`));
    document.head.append(element);
  });
  const [, , langJson] = await Promise.all([
    load("emulator.min.js"),
    load("emulator.min.css", true),
    fetch(new URL(`localization/${window.EJS_language}.json`, base)).then((response) => {
      if (!response.ok) throw new Error("Could not load game language");
      return response.json();
    }),
  ]);
  if (config.desktop) {
    // The pinned runtime normally mounts IDBFS here. Desktop persistence belongs
    // to the host adapter; the core only needs a working in-memory filesystem.
    const GameManager = window.EJS_GameManager;
    window.EJS_GameManager = class extends GameManager {
      async mountFileSystems() {
        this.mkdir("/data");
        this.mkdir("/data/saves");
        this.FS.mount(this.FS.filesystems.MEMFS, {}, "/data/saves");
        for (const file of config.nativeFiles || []) {
          const prefix = `/data/saves/${config.id}/`;
          if (!file.path.startsWith(prefix) || file.path.split("/").includes(".."))
            throw new Error("Invalid save path");
          this.FS.mkdirTree(file.path.slice(0, file.path.lastIndexOf("/")));
          this.FS.writeFile(file.path, new Uint8Array(file.data));
        }
      }
    };
  }
  class PlayerEmulator extends EmulatorJS {
    // This release is pinned; avoid an unrelated upstream request on localhost.
    checkForUpdates() {}
    saveInBrowserSupported() {
      return config.desktop ? false : super.saveInBrowserSupported();
    }
    addEventListener(element, listener, callback) {
      // The host saves before closing the iframe. Upstream's unload handler
      // restarts the core and rewrites saves while the frame is being destroyed.
      if (element === window && listener === "beforeunload") return [];
      return super.addEventListener(element, listener, callback);
    }
  }
  window.EJS_emulator = new PlayerEmulator(window.EJS_player, {
    dataPath: base.href,
    system: window.EJS_core,
    threads: window.EJS_threads,
    controlScheme: window.EJS_controlScheme,
    gameUrl: window.EJS_gameUrl,
    biosUrl: window.EJS_biosUrl,
    gameName: window.EJS_gameName,
    gameId: window.EJS_gameID,
    startOnLoad: window.EJS_startOnLoaded,
    language: window.EJS_language,
    langJson,
    color: window.EJS_color,
    backgroundColor: window.EJS_backgroundColor,
    volume: window.EJS_volume,
    disableDatabases: true,
    disableLocalStorage: true,
    noAutoFocus: true,
    defaultOptions: window.EJS_defaultOptions,
    buttonOpts: window.EJS_Buttons,
  });
  window.EJS_emulator.on("ready", window.EJS_ready);
  window.EJS_emulator.on("start", window.EJS_onGameStart);
}
