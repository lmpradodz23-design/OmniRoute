// systemStorageData.ts — data fetchers for the System Storage settings tab:
// /api/storage/health and /api/settings/database. Each resolves to the parsed JSON
// payload, or null when the request fails or the server answers non-2xx (the error
// is logged to the console). Extracted verbatim from SystemStorageTab.tsx.

export async function fetchStorageHealthData() {
  try {
    const res = await fetch("/api/storage/health");
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Failed to fetch storage health:", err);
    return null;
  }
}

export async function fetchDatabaseSettingsData() {
  try {
    const res = await fetch("/api/settings/database");
    if (res.ok) return await res.json();
  } catch (err) {
    console.error("Failed to load database settings:", err);
  }
  return null;
}
