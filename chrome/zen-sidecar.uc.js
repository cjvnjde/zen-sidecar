// Zen Sidecar: a Sine per-window script. Sine alone loads this script and CSS.
(() => {
  let active = true;
  let acquired = false;
  let originalVisibility;
  let originalExpansion;
  let originalPanelLauncherVisibility;
  let preferences;
  let controller;
  const owner = {};
  const controls = new Map();
  const root = window.document.documentElement;

  function restoreControls() {
    for (const [control, previous] of controls) {
      control.disabled = previous.disabled;
      if (previous.title === null) {
        control.removeAttribute("title");
      } else {
        control.setAttribute("title", previous.title);
      }
    }
    controls.clear();
  }

  async function constrainLayoutControls() {
    if (!active || controller.currentID !== "viewCustomizeSidebar") {
      return;
    }
    const customize =
      controller.browser.contentDocument.querySelector("sidebar-customize");
    if (!customize) {
      return;
    }
    await customize.updateComplete;
    if (!active || !customize.isConnected ||
        controller.currentID !== "viewCustomizeSidebar") {
      return;
    }
    // Tool and extension choices remain native. Only the fixed layout controls
    // are disabled; Firefox's customizer does not honor locked prefs itself.
    for (const control of customize.shadowRoot.querySelectorAll(
      "#vertical-tabs, #position, #open-tools-from-sidebar",
    )) {
      if (!controls.has(control)) {
        controls.set(control, {
          disabled: control.disabled,
          title: control.getAttribute("title"),
        });
      }
      control.disabled = true;
      control.title = "Layout controlled by Zen Sidecar";
    }
  }

  function onSidebarShown() {
    // Drop references to the previous panel's controls when a native panel is
    // replaced, and restore any still-live controls before constraining again.
    restoreControls();
    constrainLayoutControls().catch(report);
  }

  function report(error) {
    console.error("Zen Sidecar:", error);
  }

  async function detach() {
    if (!active) {
      return;
    }
    active = false;
    window.removeEventListener("SidebarShown", onSidebarShown);
    root.removeAttribute("zen-sidecar");
    restoreControls();
    if (!acquired) {
      return;
    }
    acquired = false;
    // Release synchronously, including on window close. Another live window's
    // lease keeps the process preferences in place.
    await preferences.release(owner);
    if (!window.closed && !controller.uninitializing) {
      if (originalPanelLauncherVisibility === undefined) {
        delete controller._launcherStateAtOpen;
      } else {
        controller._launcherStateAtOpen = originalPanelLauncherVisibility;
      }
      controller._state.updateVisibility(originalVisibility, originalExpansion);
      controller.updateToolbarButton();
    }
  }

  // Register here, not inside the helper: Sine identifies this .uc.js using the
  // caller filename. It awaits this callback on disable, remove, and reload.
  window.addUnloadListener(detach);

  async function attach() {
    if (Services.appinfo.name !== "Zen" || Services.appinfo.inSafeMode) {
      return;
    }
    controller = window.SidebarController;
    if (!controller || controller.inSingleTabWindow) {
      return;
    }
    await controller.promiseInitialized;
    if (!active || window.closed || controller.uninitializing) {
      return;
    }
    if (!controller._state?.updateVisibility ||
        typeof controller.toggleRevampSidebar !== "function") {
      throw new Error("Incompatible native SidebarController");
    }
    originalVisibility = controller._state.launcherVisible;
    originalExpansion = controller._state.launcherExpanded;
    originalPanelLauncherVisibility = controller._launcherStateAtOpen;
    preferences = ChromeUtils.importESModule(
      "chrome://sine/content/zen-sidecar/chrome/zen-sidecar-prefs.mjs",
    );
    const transition = preferences.acquire(owner);
    acquired = true;
    // Pref observers own the revamp transition. Do not call it a second time.
    await transition;
    if (!active || window.closed || controller.uninitializing) {
      return;
    }
    if (!controller.sidebarRevampEnabled || !controller.revampComponentsLoaded) {
      throw new Error("Native sidebar revamp did not initialize");
    }

    // Seed once; preserve raw extension IDs and the existing tool order. Do not
    // re-enable extensions the user has hidden in the native customizer.
    if (!Services.prefs.getBoolPref("zen.sidecar.initialized", false)) {
      const tools = new Set(controller.sidebarTools);
      tools.add("bookmarks");
      tools.add("history");
      Services.prefs.setStringPref(controller.TOOLS_PREF, [...tools].join(","));
      Services.prefs.setBoolPref("zen.sidecar.initialized", true);
    }
    root.setAttribute("zen-sidecar", "true");
    controller._state.updateVisibility(true, false);
    // A panel opened before installation may remember a hidden launcher. Its
    // native close handler must return to Sidecar's visible rail, not that state.
    if (controller._launcherStateAtOpen !== undefined) {
      controller._launcherStateAtOpen = true;
    }
    controller.updateToolbarButton();
    window.addEventListener("SidebarShown", onSidebarShown);
    await constrainLayoutControls();
  }

  attach().catch(async error => {
    report(error);
    await detach().catch(report);
  });
})();
