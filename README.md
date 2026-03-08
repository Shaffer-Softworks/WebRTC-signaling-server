# Shaffer Softworks Add-ons

Home Assistant add-on repository.

## Add-ons

- **[WebRTC Signaling Server](webrtc_signaling/)** – WebRTC signaling server for LAN intercom with dashboard.

## Adding this repository

1. In Home Assistant: **Settings** → **Add-ons** → **Add-on store** → **⋮** → **Repositories**
2. Add: `https://github.com/Shaffer-Softworks/WebRTC-signaling-server#main`  
   (Use the `#main` branch so the add-on store finds it reliably, especially on Home Assistant OS.)
3. Click **Add**, then **Reload** (⋮ → Reload) so the store refreshes.
4. Install **WebRTC Signaling Server** from the list.

### Add-on still not showing (HA OS)

- **Where to look:** Open **Add-on store** and scroll down. Custom repos often appear at the bottom. Look for the repository name **“Shaffer Softworks Add-ons”** and the add-on **“WebRTC Signaling Server”** under it (not in the main “Official add-ons” list).
- **Supervisor logs:** **Settings** → **System** → **Logs** → open the **Supervisor** tab. Check for **warnings** (yellow), not only errors. Look for lines like “Can't read … config” or “repository” — those mean a repo or add-on was skipped.
- **Reload and wait:** Use ⋮ → **Reload**, wait 30 seconds, then scroll the Add-on store again.
- **Remove and re-add:** In Repositories, remove `https://github.com/Shaffer-Softworks/WebRTC-signaling-server#main`, click **Add** again, paste the same URL, then **Reload**.
- **Restart Supervisor:** **Settings** → **System** → **Supervisor** → **Restart** (or restart the host). Then open the Add-on store and scroll to find your repo.
- **Repo must be public** so the Supervisor can clone it without credentials.
- If you use a **private** repo, you must configure Git credentials on the host; the in-UI repo URL does not support tokens.
