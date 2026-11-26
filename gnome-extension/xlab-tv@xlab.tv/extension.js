// xLab TV: bring the launcher to the front without closing what is playing.
//
// - The remote's Home key (keyd maps it to F20) shows the launcher, in apps and in the overview.
// - D-Bus, for the phone remote and scripts:
//     gdbus call --session --dest org.gnome.Shell --object-path /tv/xlab/Shell \
//         --method tv.xlab.Shell.ShowLauncher
//   returns true when the launcher window was found.
// - ActivatePids(au): brings forward the window of an app that is already open, found by
//   the process ids of that app (GNOME doesn't let an app raise itself on Wayland).
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const LAUNCHER_ID = 'tv.xlab.Launcher';
const IFACE = `
<node>
  <interface name="tv.xlab.Shell">
    <method name="ShowLauncher">
      <arg type="b" direction="out" name="found"/>
    </method>
    <method name="ActivatePids">
      <arg type="au" direction="in" name="pids"/>
      <arg type="b" direction="out" name="found"/>
    </method>
  </interface>
</node>`;

function allWindows() {
    if (global.display.list_all_windows)
        return global.display.list_all_windows();
    return global.get_window_actors().map(actor => actor.meta_window);
}

function isLauncher(win) {
    const appId = win.get_gtk_application_id?.() ?? null;
    return appId === LAUNCHER_ID || win.get_wm_class() === LAUNCHER_ID;
}

export default class XlabTvExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        Main.wm.addKeybinding(
            'show-launcher', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this.ShowLauncher());
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '/tv/xlab/Shell');
    }

    disable() {
        Main.wm.removeKeybinding('show-launcher');
        this._dbus?.unexport();
        this._dbus = null;
        this._settings = null;
    }

    ShowLauncher() {
        return this._activate(allWindows().find(isLauncher));
    }

    ActivatePids(pids) {
        const wanted = new Set(pids);
        // newest first: the window the user saw last for that app
        const win = allWindows()
            .filter(w => !isLauncher(w) && wanted.has(w.get_pid()))
            .sort((a, b) => b.get_user_time() - a.get_user_time())[0];
        return this._activate(win);
    }

    _activate(win) {
        if (!win)
            return false;
        if (Main.overview.visible)
            Main.overview.hide();
        if (win.minimized)
            win.unminimize();
        Main.activateWindow(win);
        return true;
    }
}
