import { isDesktop } from "./desktop";
import * as desktop from "./desktop-updates";
import * as web from "./pwa";

export const { startAppUpdates, getAppUpdate, subscribeAppUpdate, dismissAppUpdate, applyAppUpdate } =
  isDesktop ? desktop : web;
