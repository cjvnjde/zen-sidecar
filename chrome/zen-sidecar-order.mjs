// Visibility belongs to Firefox's sidebar.main.tools; order includes hidden and
// temporarily unavailable tools so toggles and extension reloads never move them.
const ORDER_PREF = "zen.sidecar.order";

export function mergeOrder(saved, names) {
  return [
    ...new Set(
      [...saved, ...names].filter(
        (name) => typeof name === "string" && name.length > 0,
      ),
    ),
  ];
}

export function moveItem(order, source, target, after) {
  if (source === target || !order.includes(source) || !order.includes(target)) {
    return order;
  }
  const next = order.filter((name) => name !== source);
  next.splice(next.indexOf(target) + Number(after), 0, source);
  return next;
}

export async function attach(window) {
  const { document, SidebarController: controller } = window;
  const prefs = Services.prefs;
  const rail = document.querySelector("sidebar-main");
  await rail.updateComplete;
  const shadow = rail.shadowRoot;
  let disposed = false;
  let source;
  let indicator;
  let suppressClick = false;
  let clickTimer;
  const originalDraggable = new WeakMap();

  function readOrder() {
    try {
      const saved = JSON.parse(prefs.getStringPref(ORDER_PREF, "[]"));
      return Array.isArray(saved) ? saved : [];
    } catch (error) {
      console.error("Zen Sidecar: Invalid saved order", error);
      return [];
    }
  }

  function currentOrder() {
    return mergeOrder(
      readOrder(),
      [...controller.toolsAndExtensions.values()].map((tool) => tool.name),
    );
  }

  function saveOrder(order) {
    const value = JSON.stringify(order);
    if (prefs.getStringPref(ORDER_PREF, "") !== value) {
      prefs.setStringPref(ORDER_PREF, value);
    }
  }

  function applyOrder() {
    if (disposed) {
      return;
    }
    const order = currentOrder();
    const tools = controller.toolsAndExtensions;
    const positions = new Map(order.map((name, index) => [name, index]));
    const entries = [...tools];
    entries.sort((a, b) => positions.get(a[1].name) - positions.get(b[1].name));
    // Keep the native Map and tool objects; Lit owns the DOM and keyboard order.
    tools.clear();
    for (const [view, tool] of entries) {
      tools.set(view, tool);
    }
    saveOrder(order);
    rail.requestUpdate();
  }

  function buttons() {
    return shadow.querySelectorAll(".tools-and-extensions > moz-button[view]");
  }

  function toolFor(button) {
    return controller.toolsAndExtensions.get(button?.getAttribute("view"));
  }

  function eventButton(event) {
    return event
      .composedPath()
      .find(
        (node) =>
          node.localName === "moz-button" &&
          node.getRootNode() === shadow &&
          toolFor(node),
      );
  }

  function prepareButtons() {
    for (const button of buttons()) {
      if (!toolFor(button)) {
        continue;
      }
      if (!originalDraggable.has(button)) {
        originalDraggable.set(button, button.getAttribute("draggable"));
      }
      button.setAttribute("draggable", "true");
    }
  }

  function clearIndicator() {
    indicator?.removeAttribute("zen-sidecar-drop");
    indicator = null;
  }

  function endDrag() {
    source = null;
    clearIndicator();
  }

  function dropTarget(event) {
    if (!event.dataTransfer?.types.includes("application/x-zen-sidecar-tool")) {
      return null;
    }
    const button = eventButton(event);
    const tool = toolFor(button);
    if (
      !source ||
      !tool ||
      tool.disabled ||
      tool.hidden ||
      tool.name === source
    ) {
      return null;
    }
    const bounds = button.getBoundingClientRect();
    return {
      button,
      name: tool.name,
      after: event.clientY >= bounds.y + bounds.height / 2,
    };
  }

  function onDragStart(event) {
    const tool = toolFor(eventButton(event));
    if (!tool || tool.disabled || tool.hidden || !event.dataTransfer) {
      return;
    }
    source = tool.name;
    event.dataTransfer.setData("application/x-zen-sidecar-tool", source);
    event.dataTransfer.effectAllowed = "move";
    event.stopPropagation();
  }

  function onDragOver(event) {
    clearIndicator();
    const target = dropTarget(event);
    if (!target) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    indicator = target.button;
    indicator.setAttribute(
      "zen-sidecar-drop",
      target.after ? "after" : "before",
    );
  }

  function onDrop(event) {
    const target = dropTarget(event);
    const dragged = [...controller.toolsAndExtensions.values()].find(
      (tool) => tool.name === source,
    );
    if (!target || !dragged || dragged.disabled || dragged.hidden) {
      endDrag();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    saveOrder(moveItem(currentOrder(), source, target.name, target.after));
    // A completed move must not activate the tool underneath the pointer.
    suppressClick = true;
    window.clearTimeout(clickTimer);
    clickTimer = window.setTimeout(() => {
      suppressClick = false;
    }, 0);
    endDrag();
  }

  function onClick(event) {
    if (suppressClick) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function onDragLeave(event) {
    if (!shadow.contains(event.relatedTarget)) {
      clearIndicator();
    }
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      endDrag();
      return;
    }
    if (
      !event.altKey ||
      !event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      !["ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      return;
    }
    const button = eventButton(event);
    if (!button) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const visible = [...buttons()].filter((item) => {
      const tool = toolFor(item);
      return tool && !tool.disabled && !tool.hidden;
    });
    const down = event.key === "ArrowDown";
    const target = visible[visible.indexOf(button) + (down ? 1 : -1)];
    if (target) {
      saveOrder(
        moveItem(
          currentOrder(),
          toolFor(button).name,
          toolFor(target).name,
          down,
        ),
      );
      rail.updateComplete.then(() => {
        if (!disposed && button.isConnected) {
          button.focus();
        }
      });
    }
  }

  const style = document.createElement("style");
  style.textContent = `
    moz-button[draggable="true"] { cursor: grab; }
    moz-button[zen-sidecar-drop="before"] {
      box-shadow: 0 -2px var(--color-accent-primary, AccentColor);
    }
    moz-button[zen-sidecar-drop="after"] {
      box-shadow: 0 2px var(--color-accent-primary, AccentColor);
    }
  `;
  shadow.appendChild(style);
  const observer = new window.MutationObserver(prepareButtons);
  observer.observe(shadow, { childList: true, subtree: true });
  const itemEvents = [
    "SidebarItemAdded",
    "SidebarItemChanged",
    "SidebarItemRemoved",
  ];
  const listeners = {
    dragstart: onDragStart,
    dragover: onDragOver,
    drop: onDrop,
    dragend: endDrag,
    dragleave: onDragLeave,
    keydown: onKeyDown,
    click: onClick,
  };
  for (const type of itemEvents) {
    window.addEventListener(type, applyOrder);
  }
  for (const [type, listener] of Object.entries(listeners)) {
    shadow.addEventListener(type, listener, true);
  }
  prefs.addObserver(ORDER_PREF, applyOrder);
  applyOrder();
  prepareButtons();

  return () => {
    disposed = true;
    prefs.removeObserver(ORDER_PREF, applyOrder);
    observer.disconnect();
    window.clearTimeout(clickTimer);
    endDrag();
    for (const type of itemEvents) {
      window.removeEventListener(type, applyOrder);
    }
    for (const [type, listener] of Object.entries(listeners)) {
      shadow.removeEventListener(type, listener, true);
    }
    for (const button of buttons()) {
      if (originalDraggable.has(button)) {
        const previous = originalDraggable.get(button);
        if (previous === null) {
          button.removeAttribute("draggable");
        } else {
          button.setAttribute("draggable", previous);
        }
      }
    }
    style.remove();
  };
}
