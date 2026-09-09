"use strict";
// Keep the native select as the value/event model; draw both its button and menu.
const RetroSelect = (() => {
  const controls = new WeakMap();
  let opened = null,
    serial = 0;
  function enhance(root = document) {
    for (const select of root.querySelectorAll("select")) {
      if (controls.has(select)) {
        controls.get(select).refresh();
        continue;
      }
      const wrapper = document.createElement("span");
      wrapper.className = "retro-select";
      select.before(wrapper);
      wrapper.append(select);
      select.hidden = true;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "retro-select-button";
      button.setAttribute("role", "combobox");
      button.setAttribute("aria-haspopup", "listbox");
      button.setAttribute("aria-expanded", "false");
      const label =
        select.getAttribute("aria-label") ||
        select.closest("label")?.childNodes[0]?.textContent.trim() ||
        "Choose an option";
      button.setAttribute("aria-label", label);
      const caption = document.createElement("span");
      caption.className = "retro-select-caption";
      const arrow = document.createElement("span");
      arrow.className = "retro-select-arrow";
      arrow.setAttribute("aria-hidden", "true");
      button.append(caption, arrow);
      wrapper.append(button);
      const menu = document.createElement("div");
      menu.className = "retro-select-menu";
      menu.id = "retro-select-menu-" + ++serial;
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", label);
      menu.setAttribute("popover", "manual");
      menu.hidden = true;
      wrapper.append(menu);
      button.setAttribute("aria-controls", menu.id);
      let active = 0,
        options = [];
      function refresh() {
        caption.textContent =
          select.selectedOptions[0]?.textContent || "Choose…";
        button.disabled = select.disabled;
      }
      function close() {
        if (menu.matches(":popover-open")) menu.hidePopover();
        menu.hidden = true;
        button.setAttribute("aria-expanded", "false");
        button.removeAttribute("aria-activedescendant");
        if (opened?.button === button) opened = null;
      }
      function highlight(index) {
        active = index;
        [...menu.children].forEach((option, i) =>
          option.classList.toggle("active", i === active),
        );
        const item = menu.children[active];
        if (item) {
          button.setAttribute("aria-activedescendant", item.id);
          item.scrollIntoView({ block: "nearest" });
        }
      }
      function choose(index) {
        if (!options[index] || options[index].disabled) return;
        select.value = options[index].value;
        refresh();
        close();
        button.focus();
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        refresh();
      }
      function open() {
        if (button.disabled) return;
        opened?.close();
        options = [...select.options];
        menu.replaceChildren(
          ...options.map((option, index) => {
            const item = document.createElement("div");
            item.id = menu.id + "-" + index;
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", String(option.selected));
            item.setAttribute("aria-disabled", String(option.disabled));
            item.textContent = option.textContent;
            item.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              choose(index);
            };
            item.onpointermove = () => {
              if (!option.disabled) highlight(index);
            };
            return item;
          }),
        );
        const rect = button.getBoundingClientRect();
        const below = innerHeight - rect.bottom - 8,
          above = rect.top - 8;
        const upwards =
          below < Math.min(options.length * 34 + 8, 240) && above > below;
        menu.style.width =
          Math.min(Math.max(rect.width, 220), innerWidth - 16) + "px";
        menu.style.maxHeight =
          Math.max(60, Math.min(320, upwards ? above : below)) + "px";
        menu.style.left =
          Math.max(
            8,
            Math.min(rect.left, innerWidth - parseFloat(menu.style.width) - 8),
          ) + "px";
        menu.style.top = upwards ? "auto" : rect.bottom + 2 + "px";
        menu.style.bottom = upwards
          ? innerHeight - rect.top + 2 + "px"
          : "auto";
        menu.hidden = false;
        if (menu.showPopover) menu.showPopover();
        button.setAttribute("aria-expanded", "true");
        opened = { button, menu, close };
        highlight(Math.max(0, select.selectedIndex));
      }
      button.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (opened?.button === button) close();
        else open();
      };
      button.onkeydown = (e) => {
        if (e.key === "Tab") {
          close();
          return;
        }
        if (e.key === "Escape") {
          if (opened?.button === button) {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
          return;
        }
        if (
          !["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(e.key)
        )
          return;
        e.preventDefault();
        if (opened?.button !== button) {
          open();
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          choose(active);
          return;
        }
        const enabled = options
          .map((o, i) => (o.disabled ? -1 : i))
          .filter((i) => i >= 0);
        if (!enabled.length) return;
        const position = enabled.indexOf(active);
        highlight(
          e.key === "Home"
            ? enabled[0]
            : e.key === "End"
              ? enabled.at(-1)
              : enabled[
                  Math.max(
                    0,
                    Math.min(
                      enabled.length - 1,
                      position + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  )
                ],
        );
      };
      select.addEventListener("change", refresh);
      controls.set(select, { refresh });
      refresh();
    }
  }
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (
        opened &&
        !opened.menu.contains(e.target) &&
        !opened.button.contains(e.target)
      )
        opened.close();
    },
    true,
  );
  document.addEventListener("close", () => opened?.close(), true);
  window.addEventListener("resize", () => opened?.close());
  document.addEventListener(
    "scroll",
    (e) => {
      if (opened && !opened.menu.contains(e.target)) opened.close();
    },
    true,
  );
  return { enhance };
})();
