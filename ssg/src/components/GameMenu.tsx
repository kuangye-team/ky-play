import { translate } from "../lib/i18n";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Download, Ellipsis, Pencil, Save, Trash2 } from "lucide-react";
import { download, getRom } from "../lib/storage";
import type { Game } from "../lib/types";

export function GameMenu({
  game,
  saveCount,
  onEdit,
  onManageSaves,
  onDelete,
  notify,
  onOpenChange,
  disabled = false,
}: {
  game: Game;
  saveCount: number;
  onEdit: () => void;
  onManageSaves: () => void;
  onDelete: () => void;
  notify: (message: string) => void;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}) {
  const downloadGame = async () => {
    try {
      download(await getRom(game), game.filename);
    } catch (error) {
      notify((error as Error).message || translate("下载没有完成，请重试。"));
    }
  };

  return (
    <Dropdown.Root onOpenChange={onOpenChange}>
      <Dropdown.Trigger
        className="icon-button"
        aria-label={translate("{{value0}} 更多操作", { value0: game.name })}
        disabled={disabled}
      >
        <Ellipsis size={20} />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="dropdown"
          sideOffset={8}
          align="end"
          collisionPadding={12}
          aria-label={translate("{{value0}} 更多操作", { value0: game.name })}
        >
          <Dropdown.Item onSelect={onEdit}>
            <Pencil size={15} />
            {translate("编辑游戏")}
          </Dropdown.Item>
          <Dropdown.Item onSelect={onManageSaves}>
            <Save size={15} />
            {translate("存档管理")}
            <span>{saveCount}</span>
          </Dropdown.Item>
          <Dropdown.Item onSelect={() => void downloadGame()}>
            <Download size={15} />
            {translate("下载游戏")}
          </Dropdown.Item>
          <Dropdown.Separator />
          <Dropdown.Item className="danger-text" onSelect={onDelete}>
            <Trash2 size={15} />
            {translate("删除游戏")}
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
