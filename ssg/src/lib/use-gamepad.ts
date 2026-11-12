import { translate } from "./i18n";
import { useCallback, useEffect, useState } from "react";
import { database } from "./storage";
import {
  defaultPadBindings,
  mappedPadValues,
  padKey,
  type Pad,
  type PadBindings,
} from "./gamepad";
import { actionsFor, type System } from "./types";

export function useGamepad(system: System) {
  const [pad, setPad] = useState<Pad | null>(null);
  const [profile, setProfile] = useState<{
    key: string;
    bindings: PadBindings;
  } | null>(null);
  const [error, setError] = useState("");
  const key = pad ? padKey(pad, system) : "";
  useEffect(() => {
    let frame = 0;
    let signature = "";
    const poll = () => {
      let next: Pad | null = null;
      try {
        const device = Array.from(navigator.getGamepads?.() || []).find(
          (item) => item?.connected,
        );
        if (device)
          next = {
            id: device.id,
            index: device.index,
            mapping: device.mapping,
            buttons: device.buttons.map((item) =>
              item.pressed ? 1 : item.value,
            ),
            axes: Array.from(device.axes),
          };
      } catch {
        /* Gamepad access can be unavailable in embedded browsers. */
      }
      const serialized = JSON.stringify(next);
      if (serialized !== signature) {
        signature = serialized;
        setPad(next);
      }
      frame = requestAnimationFrame(poll);
    };
    poll();
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!pad) {
        setProfile(null);
        return;
      }
      try {
        const bindings = (await (await database).get("settings", key)) as
          PadBindings | undefined;
        if (!cancelled)
          setProfile({
            key,
            bindings: bindings || defaultPadBindings(pad, system),
          });
      } catch {
        if (!cancelled) {
          setProfile({
            key,
            bindings: defaultPadBindings(pad, system),
          });
          setError(translate("手柄设置没有读取成功，请重新设置。"));
        }
      }
    };
    void load();
    window.addEventListener("gamepad-bindings-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("gamepad-bindings-changed", load);
    };
  }, [key, system]);
  const save = useCallback(
    async (bindings: PadBindings) => {
      if (!key) throw new Error(translate("请先连接手柄。"));
      await (await database).put("settings", bindings, key);
      setProfile({ key, bindings });
      setError("");
      window.dispatchEvent(new Event("gamepad-bindings-changed"));
    },
    [key],
  );
  const bindings = profile?.key === key ? profile.bindings : {};
  return {
    pad,
    bindings,
    save,
    error,
    key,
    values: mappedPadValues(pad, bindings, system),
    needsSetup:
      !!pad &&
      pad.mapping !== "standard" &&
      actionsFor(system).some((action) => !bindings[action.id]?.length),
  };
}
