// Shared by Sine's per-window scripts. Firefox caches this system module until
// restart; there are no background listeners or window references between uses.
const prefs = Services.prefs;
const defaults = prefs.getDefaultBranch("");
const owners = new Set();
// Dependency order: native revamp writes verticalTabs and visibility; changing
// verticalTabs can also write visibility. Snapshot dependents first.
const settings = [
  ["sidebar.visibility", "String", "hide-on-close"],
  ["sidebar.position_start", "Bool", true],
  ["sidebar.verticalTabs", "Bool", false],
  ["sidebar.revamp", "Bool", true],
];
let saved;
let transition = Promise.resolve();

// Measured on Zen 1.21.15b: locked default writes do nothing; unlock/set/lock
// invokes revamp three times ([false,true,true]). Coalesce only this synchronous
// transaction, restore the methods in finally, then await one native rebuild.
function transaction(change) {
  const controllers = [];
  const pending = [];
  for (const window of Services.wm.getEnumerator("navigator:browser")) {
    const controller = window.SidebarController;
    if (!controller?._state || controller.uninitializing) {
      continue;
    }
    const original = controller.toggleRevampSidebar;
    const before = controller.sidebarRevampEnabled;
    const deferred = () => Promise.resolve();
    controllers.push({ window, controller, original, before, deferred });
    controller.toggleRevampSidebar = deferred;
  }
  try {
    change();
  } finally {
    for (const { controller, original, deferred } of controllers) {
      if (controller.toggleRevampSidebar === deferred) {
        controller.toggleRevampSidebar = original;
      }
    }
    for (const { window, controller, original, before } of controllers) {
      if (!window.closed && !controller.uninitializing &&
          before !== controller.sidebarRevampEnabled) {
        // Native legacy re-init does not remove the revamp Escape listener.
        if (!controller.sidebarRevampEnabled &&
            controller._sidebarMainKeydownHandler) {
          window.removeEventListener("keydown", controller._sidebarMainKeydownHandler);
          controller._sidebarMainKeydownHandler = null;
        }
        pending.push(original.call(controller));
      }
    }
  }
  return Promise.all(pending);
}

function restoreUsers() {
  for (const pref of [...saved].reverse()) {
    if (pref.hasUser) {
      prefs[`set${pref.type}Pref`](pref.name, pref.user);
    } else {
      prefs.clearUserPref(pref.name);
    }
  }
}

function restore() {
  // Restore the driver before its dependents, and user values after all defaults
  // and locks: native observers themselves write user preferences during this.
  for (const pref of [...saved].reverse()) {
    prefs.unlockPref(pref.name);
    defaults[`set${pref.type}Pref`](pref.name, pref.value);
    if (pref.locked) {
      prefs.lockPref(pref.name);
    }
  }
  restoreUsers();
}

export function acquire(owner) {
  if (owners.has(owner)) {
    return transition;
  }
  if (!owners.size) {
    // Require native defaults; never invent a restoration value for an unknown
    // browser version. Capture unlocked user values before any observer can run.
    saved = settings.map(([name, type, override]) => {
      const locked = prefs.prefIsLocked(name);
      const hasUser = prefs.prefHasUserValue(name);
      return {
        name, type, override, locked, hasUser,
        value: defaults[`get${type}Pref`](name),
        user: hasUser && !locked ? prefs[`get${type}Pref`](name) : undefined,
      };
    });
    transition = transaction(() => {
      try {
        // nsIPrefBranch cannot read a locked user value. Unlock in dependency
        // order, capturing each value before another pref's observer can write it.
        for (const pref of saved) {
          prefs.unlockPref(pref.name);
          if (pref.locked && pref.hasUser) {
            pref.user = prefs[`get${pref.type}Pref`](pref.name);
          }
        }
        for (const pref of saved) {
          defaults[`set${pref.type}Pref`](pref.name, pref.override);
          prefs.lockPref(pref.name);
        }
      } catch (error) {
        restore();
        saved = null;
        throw error;
      }
    });
  }
  owners.add(owner);
  return transition;
}

export function release(owner) {
  if (!owners.delete(owner) || owners.size) {
    return transition;
  }
  transition = transaction(restore);
  saved = null;
  return transition;
}
