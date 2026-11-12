import games from "../../licenses/games/bundled.json";
import { gameCovers } from "virtual:app-assets";
import { translate } from "./i18n";
import type { Game } from "./types";

export const bundledGames = games;

export function getBundledGame(game: Game) {
  return bundledGames.find((entry) => entry.id === game.id && entry.sha256 === game.hash);
}

export function isBundledGame(game: Game) {
  return !!getBundledGame(game);
}

export function localizeGame(game: Game): Game {
  const bundled = getBundledGame(game);
  if (!bundled) return game;
  return {
    ...game,
    name: [bundled.name, bundled.englishName].includes(game.name) ? translate(bundled.name) : game.name,
    // Keep only the source path in storage; resolve built-in artwork for display.
    cover: game.cover === bundled.cover ? gameCovers[bundled.id] : game.cover,
  };
}

export function initialGames(): Game[] {
  return bundledGames.map((game) => ({
    id: game.id,
    name: game.name,
    filename: game.romUrl.split("/").pop()!,
    cover: game.cover,
    system: "nes",
    tags: [],
    favorite: false,
    added: Date.now(),
    playSeconds: 0,
    size: game.size,
    hash: game.sha256,
  }));
}
