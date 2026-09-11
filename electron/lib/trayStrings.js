/**
 * Minimal main-process string table for the tray menu, tooltip and update notification
 * (I3). The dashboard has full next-intl locales; the Electron main process only needs
 * these few labels, keyed by the OS locale with an English fallback. Keep every key
 * present in every locale — tests/unit/electron-tray-strings-i3.test.ts enforces it.
 */

const TRAY_STRINGS = {
  en: {
    openApp: "Open OmniRoute",
    openDashboard: "Open Dashboard",
    serverPort: "Server Port",
    portLabel: "Port: {port}",
    remoteServer: "Remote Server",
    remoteConnected: "Connected: {url}",
    remoteLocal: "Using local embedded server",
    remoteConnect: "Connect to Remote Server…",
    remoteDisconnect: "Disconnect (use Local Server)",
    whenDashboardCloses: "When Dashboard Closes",
    keepLoaded: "Keep Loaded (Faster Reopen)",
    unloadRenderer: "Unload Renderer (Lower Memory)",
    checkForUpdates: "Check for Updates",
    quit: "Quit",
    tooltip: "OmniRoute",
    updateReadyTitle: "OmniRoute Update Ready",
    updateReadyBody: "Version {version} is ready to install. Click to restart.",
    remotePromptTitle: "Connect to Remote Server",
  },
  pt: {
    openApp: "Abrir OmniRoute",
    openDashboard: "Abrir painel",
    serverPort: "Porta do servidor",
    portLabel: "Porta: {port}",
    remoteServer: "Servidor remoto",
    remoteConnected: "Conectado: {url}",
    remoteLocal: "Usando o servidor local embutido",
    remoteConnect: "Conectar a um servidor remoto…",
    remoteDisconnect: "Desconectar (usar servidor local)",
    whenDashboardCloses: "Ao fechar o painel",
    keepLoaded: "Manter carregado (reabre mais rápido)",
    unloadRenderer: "Descarregar a janela (menos memória)",
    checkForUpdates: "Verificar atualizações",
    quit: "Sair",
    tooltip: "OmniRoute",
    updateReadyTitle: "Atualização do OmniRoute pronta",
    updateReadyBody: "A versão {version} está pronta para instalar. Clique para reiniciar.",
    remotePromptTitle: "Conectar a um servidor remoto",
  },
};

/** "pt-BR" / "pt_PT" / "pt" → "pt"; anything unsupported → "en". */
function resolveTrayLocale(osLocale) {
  const base = String(osLocale || "")
    .toLowerCase()
    .split(/[-_]/)[0];
  return Object.prototype.hasOwnProperty.call(TRAY_STRINGS, base) ? base : "en";
}

function interpolate(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/** Translator bound to an OS locale; unknown keys come back verbatim (never throws). */
function createTrayTranslator(osLocale) {
  const locale = resolveTrayLocale(osLocale);
  return (key, params) => {
    const template = TRAY_STRINGS[locale][key] ?? TRAY_STRINGS.en[key];
    return typeof template === "string" ? interpolate(template, params) : key;
  };
}

module.exports = { TRAY_STRINGS, createTrayTranslator, resolveTrayLocale };
