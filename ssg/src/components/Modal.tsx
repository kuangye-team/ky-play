import { translate } from "../lib/i18n";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
export function Modal({
  title,
  description,
  headingContent,
  children,
  onClose,
  wide = false,
  className = "",
  onCloseAutoFocus,
  autoFocus = false,
}: {
  title: string;
  description?: string;
  headingContent?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  autoFocus?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal ${wide ? "modal-wide" : ""} ${className}`}
          onOpenAutoFocus={(e) => {
            if (!autoFocus) e.preventDefault();
          }}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description || " "}</Dialog.Description>
              {headingContent}
            </div>
            <Dialog.Close
              className="icon-button"
              aria-label={translate("关闭")}
            >
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
