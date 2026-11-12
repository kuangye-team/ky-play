import { Link } from "react-router";
import { getBundledGame } from "../lib/bundled-game";
import { translate } from "../lib/i18n";
import type { Game } from "../lib/types";

export function BundledGameCredit({ game, showName = false }: { game: Game; showName?: boolean }) {
  const bundled = getBundledGame(game);
  if (!bundled) return null;
  return (
    <p className="bundled-game-credit">
      {showName && <>{translate(bundled.name)}{" · "}</>}
      {translate("由 {{value0}} 创作", { value0: bundled.author })}
      {" · "}
      <Link to={`/about#${bundled.id}`}>{translate("游戏许可与源码")}</Link>
    </p>
  );
}
