import { translate } from "../lib/i18n";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ArrowDownUp, Check, ChevronDown, type LucideIcon } from "lucide-react";

type SortOption = {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

export function SortMenu({
  value,
  onValueChange,
  options,
  label,
  title,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SortOption[];
  label: string;
  title: string;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        className="sort-trigger"
        aria-label={translate(label || "")}
      >
        <ArrowDownUp size={15} />
        <span>
          {translate(
            options.find((option) => option.value === value)?.label || "",
          )}
        </span>
        <ChevronDown className="sort-chevron" size={14} />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="dropdown sort-menu"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label={title}
        >
          <Dropdown.Label className="sort-menu-label">{title}</Dropdown.Label>
          <Dropdown.RadioGroup value={value} onValueChange={onValueChange}>
            {options.map(({ value, label, description, icon: Icon }) => (
              <Dropdown.RadioItem
                key={value}
                value={value}
                textValue={translate(label)}
                className="sort-option"
              >
                <span className="sort-option-icon">
                  <Icon size={17} />
                </span>
                <span className="sort-option-copy">
                  <strong>{translate(label)}</strong>
                  <small>{translate(description)}</small>
                </span>
                <Dropdown.ItemIndicator className="sort-option-check">
                  <Check size={16} />
                </Dropdown.ItemIndicator>
              </Dropdown.RadioItem>
            ))}
          </Dropdown.RadioGroup>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
