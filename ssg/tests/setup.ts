import "fake-indexeddb/auto";

// Existing fixtures assert Chinese copy; language-specific browser tests override this.
import { vi } from "vitest";
vi.stubGlobal("navigator", { language: "zh-CN", languages: ["zh-CN"] });
