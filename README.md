# Shaffer Softworks Add-ons

Home Assistant add-on repository.

## Add-ons

- **[WebRTC Signaling Server](webrtc_signaling/)** – WebRTC signaling server for LAN intercom with dashboard.

## Adding this repository

1. In Home Assistant: **Settings** → **Add-ons** → **Add-on store** → **⋮** → **Repositories**
2. Add: `https://github.com/Shaffer-Softworks/WebRTC-signaling-server`
   - On Home Assistant OS, if the add-on doesn’t appear, try adding with the branch: `https://github.com/Shaffer-Softworks/WebRTC-signaling-server#main`
3. Click **Add**, then **Reload** (⋮ → Reload) so the store refreshes.
4. Install **WebRTC Signaling Server** from the list.

### Add-on still not showing (HA OS)

- **Repo must be public** so the Supervisor can clone it without credentials. If the repo is private, the clone can fail and no add-ons will appear.
- **Remove and re-add** the repository (⋮ → Repositories → remove the URL → Add again with the URL above).
- **Check Supervisor logs**: **Settings** → **System** → **Logs** → **Supervisor**. Look for errors about cloning or “repository” (e.g. “Could not clone”, “No repository information”).
- If you use a **private** repo, you must configure Git credentials on the host (e.g. via an add-on or `/root/.git-credentials`); the in-UI repo URL does not support tokens.
