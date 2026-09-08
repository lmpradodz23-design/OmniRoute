// @vitest-environment jsdom
//
// Prova do fix "abre a mesma página por cima e não volta": no passo manual do login OAuth
// (cenário de servidor REMOTO — isTrueLocalhost=false), o painel agora oferece um botão
// "Abrir em nova aba" que dispara window.open(authUrl, "_blank") — gesto do usuário, então o
// navegador não bloqueia e NÃO abre por cima do painel. O painel segue aberto para receber o retorno.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next-intl", () => {
  const t = ((key: string) => key) as ((key: string) => string) & {
    rich: (key: string, ...args: unknown[]) => string;
    has: (key: string) => boolean;
  };
  t.rich = (key: string) => key;
  t.has = () => false;
  return { useTranslations: () => t };
});

const { OAuthManualInputPanel } = await import("../../src/shared/components/OAuthModalPanels.tsx");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function findButtonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent || "").includes(text)
  ) as HTMLButtonElement | undefined;
}

describe("OAuthManualInputPanel — abrir login em nova aba (fix servidor remoto)", () => {
  const AUTH_URL = "https://api.anthropic.com/oauth/authorize?client_id=x&code_challenge=y";

  it('clicar "Abrir em nova aba" chama window.open(authUrl, "_blank")', () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    act(() => {
      root.render(
        <OAuthManualInputPanel
          provider="claude"
          isGoogleOAuth={false}
          isTrueLocalhost={false}
          googleHint={null}
          authUrl={AUTH_URL}
          callbackUrl=""
          placeholderUrl="https://omniroute.dz23.online/callback?code=..."
          canSubmit={false}
          onCallbackUrlChange={() => {}}
          onSubmit={() => {}}
          onClose={() => {}}
        />
      );
    });

    const btn = findButtonByText("Abrir em nova aba");
    expect(btn, 'botão "Abrir em nova aba" deve existir').toBeTruthy();

    act(() => {
      btn!.click();
    });

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(AUTH_URL, "_blank", "noopener,noreferrer");
  });

  it("sem authUrl, o botão de abrir fica desabilitado (não abre nada)", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    act(() => {
      root.render(
        <OAuthManualInputPanel
          provider="claude"
          isGoogleOAuth={false}
          isTrueLocalhost={false}
          googleHint={null}
          authUrl=""
          callbackUrl=""
          placeholderUrl=""
          canSubmit={false}
          onCallbackUrlChange={() => {}}
          onSubmit={() => {}}
          onClose={() => {}}
        />
      );
    });

    const btn = findButtonByText("Abrir em nova aba");
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(true);
    act(() => btn!.click());
    expect(openSpy).not.toHaveBeenCalled();
  });
});
