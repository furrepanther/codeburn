# CodeBurn GNOME Shell extension

Native GNOME panel button that shows today's AI coding spend with a click-to-open popover, matching the feel of Ubuntu's Quick Settings menu.

This is an alternative to the cross-platform Tauri tray app in `../desktop/`. Use this on GNOME for the most native UX. The Tauri app stays the right choice for KDE, Unity, wlroots compositors, Windows, and headless systems.

## Requirements

* GNOME Shell 45, 46, 47, or 48 (Ubuntu 22.04 LTS, 24.04 LTS, and Fedora 39+)
* `codeburn` CLI on PATH (`npm install -g codeburn`)

## Install (from source, local user)

```bash
cp -r extensions/gnome-shell/codeburn@agentseal.org ~/.local/share/gnome-shell/extensions/
gnome-extensions enable codeburn@agentseal.org
```

Then restart GNOME Shell so the extension loads:

* **X11:** press `Alt + F2`, type `r`, press Enter.
* **Wayland:** log out and log back in (GNOME on Wayland has no in-session shell restart).

## What it shows

Panel button:
* 🔥 icon
* Today's cost (e.g. `$24.73`)

Popup menu:
* Header: period + cost + call count + session count
* Top 5 activities (Coding, Debugging, Testing, etc.) with per-activity cost and turn count
* Optimize findings count with potential savings (if any)
* Refresh and Open Full Report actions

Data refreshes every 60 seconds. Right-click the panel button to open the default panel context menu.

## Uninstall

```bash
gnome-extensions disable codeburn@agentseal.org
rm -rf ~/.local/share/gnome-shell/extensions/codeburn@agentseal.org
```

## Development

Run a nested shell to iterate without restarting your session (X11 only):

```bash
dbus-run-session -- gnome-shell --nested --wayland
```

Tail the extension log:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

The extension uses the GNOME 45+ ESM-based extension API (`import` + `Extension` class). It will not load on GNOME 44 or earlier.
