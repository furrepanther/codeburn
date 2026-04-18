/*
 * CodeBurn GNOME Shell extension.
 *
 * Renders a flame + today's cost label in the top panel and opens a native
 * PopupMenu on click, matching Ubuntu's Quick Settings feel. Unlike the Tauri
 * tray app (desktop/), this lives inside gnome-shell so it can anchor the
 * popover directly under its panel button without going through SNI.
 *
 * Data source: `codeburn status --format menubar-json`, polled every 60s.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const REFRESH_INTERVAL_SECONDS = 60;
const TOP_ACTIVITIES = 5;
const CODEBURN_BIN = 'codeburn';

const CodeburnIndicator = GObject.registerClass(
class CodeburnIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'CodeBurn');

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box codeburn-panel'});
        this._flame = new St.Label({
            text: '🔥',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'codeburn-flame',
        });
        this._label = new St.Label({
            text: '…',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'codeburn-label',
        });
        box.add_child(this._flame);
        box.add_child(this._label);
        this.add_child(box);

        this._headerItem = new PopupMenu.PopupMenuItem('Loading…', {reactive: false});
        this._headerItem.label.style_class = 'codeburn-header';
        this.menu.addMenuItem(this._headerItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._activitySection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._activitySection);

        this._findingsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._findingsSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refresh = new PopupMenu.PopupMenuItem('Refresh');
        refresh.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refresh);

        const openReport = new PopupMenu.PopupMenuItem('Open Full Report');
        openReport.connect('activate', () => this._spawnTerminal([CODEBURN_BIN, 'report']));
        this.menu.addMenuItem(openReport);

        this._refresh();
        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_SECONDS,
            () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    _refresh() {
        let proc;
        try {
            proc = Gio.Subprocess.new(
                [CODEBURN_BIN, 'status', '--format', 'menubar-json'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            );
        } catch (e) {
            this._renderError(`codeburn CLI not found on PATH. Install the npm package first.`);
            return;
        }

        proc.communicate_utf8_async(null, null, (p, result) => {
            try {
                const [ok, stdout, stderr] = p.communicate_utf8_finish(result);
                if (!ok) {
                    this._renderError(`codeburn failed: ${stderr || 'unknown error'}`);
                    return;
                }
                if (!stdout) {
                    this._renderError('codeburn returned no output');
                    return;
                }
                const payload = JSON.parse(stdout);
                this._render(payload);
            } catch (e) {
                this._renderError(`parse error: ${e.message}`);
            }
        });
    }

    _render(payload) {
        const current = payload?.current ?? {};
        const cost = Number(current.cost ?? 0);
        const formatted = formatUsd(cost);
        this._label.set_text(formatted);

        const label = current.label ?? '';
        const calls = current.calls ?? 0;
        const sessions = current.sessions ?? 0;
        this._headerItem.label.set_text(
            `${label}  ${formatted}  ${calls.toLocaleString()} calls  ${sessions} sessions`,
        );

        this._activitySection.removeAll();
        const activities = Array.isArray(current.topActivities) ? current.topActivities : [];
        if (activities.length === 0) {
            const empty = new PopupMenu.PopupMenuItem('No activity for this period', {reactive: false});
            empty.label.style_class = 'codeburn-empty';
            this._activitySection.addMenuItem(empty);
        } else {
            for (const a of activities.slice(0, TOP_ACTIVITIES)) {
                const line = `${a.name}   ${formatUsd(a.cost)}   ${a.turns} turns`;
                const item = new PopupMenu.PopupMenuItem(line, {reactive: false});
                item.label.style_class = 'codeburn-activity';
                this._activitySection.addMenuItem(item);
            }
        }

        this._findingsSection.removeAll();
        const findingCount = payload?.optimize?.findingCount ?? 0;
        if (findingCount > 0) {
            this._findingsSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const savings = Number(payload.optimize.savingsUSD ?? 0);
            const text = `${findingCount} optimize findings   save ~${formatUsd(savings)}`;
            const item = new PopupMenu.PopupMenuItem(text);
            item.label.style_class = 'codeburn-findings';
            item.connect('activate', () => this._spawnTerminal([CODEBURN_BIN, 'optimize']));
            this._findingsSection.addMenuItem(item);
        }
    }

    _renderError(message) {
        this._label.set_text('!');
        this._headerItem.label.set_text(message);
        this._activitySection.removeAll();
        this._findingsSection.removeAll();
    }

    _spawnTerminal(argv) {
        // Quote arguments into a single command string for bash -lc. argv here only ever
        // contains static identifiers from our own code so plain join is safe.
        const command = `${argv.join(' ')}; echo; read -n 1 -s -r -p 'Press any key to close...'`;
        try {
            Gio.Subprocess.new(
                ['gnome-terminal', '--', 'bash', '-lc', command],
                Gio.SubprocessFlags.NONE,
            );
        } catch (e) {
            log(`codeburn: terminal spawn error: ${e.message}`);
        }
    }

    destroy() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
        super.destroy();
    }
});

function formatUsd(value) {
    const abs = Math.abs(value);
    if (abs >= 1000) {
        return `$${(value / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
    }
    return `$${value.toFixed(2)}`;
}

export default class CodeburnExtension extends Extension {
    enable() {
        this._indicator = new CodeburnIndicator();
        Main.panel.addToStatusArea('codeburn', this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
