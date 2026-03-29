# Shaffer Softworks add-ons

Home Assistant add-on repository.

## Add-ons

- **[WebRTC Signaling Server](webrtc_signaling/)** — WebSocket signaling for LAN intercom, with a dashboard.

## Add the repository (Supervisor)

1. **Settings** → **Add-ons** → **Add-on store** → **⋮** → **Repositories**
2. Add: `https://github.com/Shaffer-Softworks/WebRTC-signaling-server#main`  
   Use the `#main` fragment so the store resolves the branch reliably (especially on Home Assistant OS).
3. **Add**, then **⋮** → **Reload**.
4. Install **WebRTC Signaling Server** from the list.

### Add-on does not appear

- **Store list:** Custom repos are often at the bottom. Look under **“Shaffer Softworks Add-ons”**, not under official add-ons.
- **Supervisor logs:** **Settings** → **System** → **Logs** → **Supervisor**. Check warnings (yellow) for messages about config or repository parse failures.
- **Reload:** **Reload** the store, wait ~30s, scroll again.
- **Re-add repo:** Remove the repository URL, add it again, **Reload**.
- **Restart Supervisor** (or the host) if the store still looks stale.
- **Public repo:** The Supervisor clones over Git; private repos need credentials on the host (the UI URL does not carry tokens).
