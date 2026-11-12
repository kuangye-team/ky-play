/* Performance defaults for the bundled EmulatorJS 4.2.3 WASM cores. */
function playerPerformance(core) {
  // Restore N64's previously working execution path after a signature-mismatch
  // report following the thread rollout. SharedArrayBuffer availability alone
  // does not establish compatibility with this pinned core's pthread build.
  const threads =
    core !== "mupen64plus_next" &&
    window.crossOriginIsolated &&
    typeof SharedArrayBuffer === "function";
  const cpuCount = Math.max(1, navigator.hardwareConcurrency || 2);
  const parallel = threads && cpuCount > 1;
  const heavyCore = ["ppsspp", "desmume", "mupen64plus_next"].includes(core);

  const profiles = {
    fceumm: {
      fceumm_overclocking: "2x-Postrender",
      fceumm_nospritelimit: "enabled",
      fceumm_ntsc_filter: "disabled",
    },
    snes9x: {
      snes9x_overclock_cycles: "compatible",
      snes9x_overclock_superfx: "200%",
      snes9x_reduce_sprite_flicker: "enabled",
    },
    genesis_plus_gx: {
      genesis_plus_gx_overclock: "150",
      genesis_plus_gx_no_sprite_limit: "enabled",
      genesis_plus_gx_blargg_ntsc_filter: "disabled",
      genesis_plus_gx_lcd_filter: "disabled",
      genesis_plus_gx_frameskip: "disabled",
    },
    mgba: {
      mgba_frameskip: "disabled",
    },
    // These cores also receive the shared thread, graphics and audio settings.
    gambatte: {},
    mednafen_wswan: {
      wswan_frameskip: "disabled",
    },
    fbneo: {
      "fbneo-cpu-speed-adjust": "125%",
    },
    pcsx_rearmed: {
      pcsx_rearmed_gpu_thread_rendering: parallel ? "enabled" : "disabled",
      pcsx_rearmed_frameskip_type: "disabled",
    },
    desmume: {
      desmume_num_cores: String(parallel ? Math.min(4, cpuCount) : 1),
      desmume_advanced_timing: "disabled",
      desmume_internal_resolution: "256x192",
      desmume_gfx_texture_scaling: "1",
      desmume_gfx_texture_deposterize: "disabled",
      desmume_frameskip: "0",
      // The ROM is already in the browser's in-memory filesystem. An extra
      // full-ROM copy can exhaust the WASM heap for the bundled 512 MB game.
      desmume_load_to_memory: "disabled",
    },
    ppsspp: {
      // Emscripten uses the IR interpreter, not the native CPU's JIT backend.
      ppsspp_cpu_core: "IR JIT",
      ppsspp_fast_memory: "enabled",
      ppsspp_io_timing_method: "Fast",
      ppsspp_force_lag_sync: "disabled",
      ppsspp_software_rendering: "disabled",
      ppsspp_gpu_hardware_transform: "enabled",
      ppsspp_software_skinning: "enabled",
      ppsspp_lazy_texture_caching: "enabled",
      ppsspp_inflight_frames: "Up to 2",
      ppsspp_internal_resolution: "480x272",
      ppsspp_mulitsample_level: "Disabled",
      ppsspp_texture_scaling_level: "disabled",
      ppsspp_texture_shader: "disabled",
      ppsspp_texture_anisotropic_filtering: "disabled",
      ppsspp_texture_deposterize: "disabled",
      ppsspp_frameskip: "0",
      ppsspp_auto_frameskip: "disabled",
      // Keep game-selected clocks: forcing a higher clock increases host work
      // and can worsen audio starvation on this interpreted WASM build.
      ppsspp_locked_cpu_speed: "disabled",
      ppsspp_cache_iso: "disabled",
    },
    mupen64plus_next: {
      // Keep the core's fastest compiled CPU backend rather than forcing a
      // native-only dynarec or overriding a faster backend in a future build.
      "mupen64plus-rsp-plugin": "hle",
      "mupen64plus-ThreadedRenderer": "False",
      "mupen64plus-43screensize": "320x240",
      "mupen64plus-MultiSampling": "0",
      "mupen64plus-HybridFilter": "False",
      "mupen64plus-EnableTextureCache": "True",
      "mupen64plus-EnableShadersStorage": "True",
    },
  };

  return {
    threads,
    defaultOptions: {
      "virtual-gamepad": "disabled",
      "save-state-location": "download",
      ejs_threads: threads ? "enabled" : "disabled",
      webgl2Enabled: "enabled",
      shader: "disabled",
      rewindEnabled: "disabled",
      vsync: "enabled",
      fps: "hide",
      ...profiles[core],
    },
    retroarchOpts: {
      // Give scene changes breathing room without changing the game's speed.
      audio_latency: heavyCore ? 192 : 128,
      audio_sync: true,
      audio_rate_control: true,
      video_vsync: true,
      video_frame_delay: 0,
      video_smooth: false,
      rewind_enable: false,
      run_ahead_enabled: false,
    },
  };
}

function preferPerformanceGraphics(canvas) {
  // Scope the GPU preference to the emulator's own canvas. Browsers may ignore
  // this hint; preserve every context attribute requested by the WASM runtime.
  const getContext = canvas.getContext.bind(canvas);
  canvas.getContext = (type, attributes, ...rest) =>
    getContext(
      type,
      ["webgl", "webgl2", "experimental-webgl"].includes(type)
        ? { ...attributes, powerPreference: "high-performance" }
        : attributes,
      ...rest,
    );
}
