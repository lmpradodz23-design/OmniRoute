(function () {
  const input = document.getElementById("url-input");
  const errorEl = document.getElementById("error");
  const saveBtn = document.getElementById("save-btn");
  const cancelBtn = document.getElementById("cancel-btn");

  function isValidOrEmpty(value) {
    const trimmed = value.trim();
    if (!trimmed) return true; // empty = disconnect, handled by main process
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  window.remoteServerPrompt.getInitialUrl().then((url) => {
    input.value = url || "";
    input.focus();
  });

  saveBtn.addEventListener("click", () => {
    const value = input.value.trim();
    if (!isValidOrEmpty(value)) {
      errorEl.textContent = "Enter a valid http:// or https:// URL, or leave blank to disconnect.";
      return;
    }
    // The main process applies the transport policy (https anywhere, http only on a private
    // network) and answers with the reason when it refuses.
    saveBtn.disabled = true;
    Promise.resolve(window.remoteServerPrompt.submit(value))
      .then((result) => {
        if (result && result.ok === false) {
          errorEl.textContent = result.error || "That URL was rejected.";
        }
      })
      .catch(() => {
        errorEl.textContent = "Could not apply the URL. Try again.";
      })
      .finally(() => {
        saveBtn.disabled = false;
      });
  });

  cancelBtn.addEventListener("click", () => {
    window.remoteServerPrompt.cancel();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveBtn.click();
    if (event.key === "Escape") cancelBtn.click();
  });
})();
