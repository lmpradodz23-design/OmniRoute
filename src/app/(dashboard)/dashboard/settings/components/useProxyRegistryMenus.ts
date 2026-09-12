// useProxyRegistryMenus.ts — open/closed state, anchor refs and click-outside
// dismissal for the two header dropdowns of ProxyRegistryManager (the actions menu
// and the relay menu). Extracted verbatim from ProxyRegistryManager.tsx; the hook
// call order inside the component is unchanged.

import { useEffect, useRef, useState } from "react";

export function useProxyRegistryMenus() {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [relayMenuOpen, setRelayMenuOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const relayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!actionsOpen && !relayMenuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (actionsOpen && actionsRef.current && !actionsRef.current.contains(target)) {
        setActionsOpen(false);
      }
      if (relayMenuOpen && relayRef.current && !relayRef.current.contains(target)) {
        setRelayMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [actionsOpen, relayMenuOpen]);

  const closeActions = () => {
    setActionsOpen(false);
    setRelayMenuOpen(false);
  };

  return {
    actionsOpen,
    setActionsOpen,
    relayMenuOpen,
    setRelayMenuOpen,
    actionsRef,
    relayRef,
    closeActions,
  };
}
