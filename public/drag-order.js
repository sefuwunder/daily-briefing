/* drag-order.js — drag-to-reorder dashboard widgets. Zero deps.
 *
 * - Drag starts ONLY from the grip handle in each card head, so text
 *   selection, tabs, inputs, buttons and bookmark folds keep working.
 * - Desktop uses HTML5 drag-and-drop; touch devices use a Pointer Events
 *   fallback (HTML5 DnD never fires on touch).
 * - Order persists in localStorage as an array of data-widget keys and is
 *   applied synchronously at load, before first paint.
 * - Moving nodes with appendChild/insertBefore preserves canvas/WebGL
 *   state, so the plant/meadow/pet widgets survive a reorder untouched.
 */
(function () {
  "use strict";

  var ORDER_KEY = "briefing_widget_order";
  var HANDLE_TEXT = "\u22EE\u22EE"; // ⋮⋮

  /* ---- pure / storage helpers (tested in checks/) ---- */

  function keysOf(grid) {
    var out = [];
    var kids = grid.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i].getAttribute && kids[i].getAttribute("data-widget");
      if (k) out.push(k);
    }
    return out;
  }

  // saved keys that still exist (in saved order), then any current keys
  // missing from storage appended at the end. Unknown keys are ignored.
  function sanitizeOrder(saved, current) {
    var seen = {};
    var out = [];
    var i, k;
    var arr = Array.isArray(saved) ? saved : [];
    for (i = 0; i < arr.length; i++) {
      k = String(arr[i]);
      if (current.indexOf(k) !== -1 && !seen[k]) { seen[k] = 1; out.push(k); }
    }
    for (i = 0; i < current.length; i++) {
      k = current[i];
      if (!seen[k]) { seen[k] = 1; out.push(k); }
    }
    return out;
  }

  function getStorage(over) {
    if (over) return over;
    return (typeof localStorage !== "undefined") ? localStorage : null;
  }

  function loadOrder(over) {
    var s = getStorage(over);
    if (!s) return null;
    try {
      var v = s.getItem(ORDER_KEY);
      if (!v) return null;
      var arr = JSON.parse(v);
      return Array.isArray(arr) ? arr.map(String) : null;
    } catch (e) { return null; }
  }

  function saveOrder(order, over) {
    var s = getStorage(over);
    if (!s) return false;
    try { s.setItem(ORDER_KEY, JSON.stringify(order)); return true; }
    catch (e) { return false; }
  }

  function clearOrder(over) {
    var s = getStorage(over);
    if (!s) return;
    try { s.removeItem(ORDER_KEY); } catch (e) {}
  }

  // Reorder grid children to match `order` exactly (for keys present in the
  // DOM). DOM children missing from `order` keep their relative order at the
  // end; unknown keys are skipped. appendChild moves nodes — canvases keep
  // their WebGL state.
  function applyOrder(grid, order) {
    if (!grid || !Array.isArray(order)) return;
    var kids = Array.prototype.slice.call(grid.children || []);
    var map = {};
    var i, k;
    for (i = 0; i < kids.length; i++) {
      k = kids[i].getAttribute && kids[i].getAttribute("data-widget");
      if (k && !map[k]) map[k] = kids[i];
    }
    var seen = {};
    var seq = [];
    for (i = 0; i < order.length; i++) {
      k = String(order[i]);
      if (map[k] && !seen[k]) { seen[k] = 1; seq.push(map[k]); }
    }
    for (i = 0; i < kids.length; i++) {
      k = kids[i].getAttribute && kids[i].getAttribute("data-widget");
      if (k && !seen[k]) { seen[k] = 1; seq.push(kids[i]); }
    }
    for (i = 0; i < seq.length; i++) grid.appendChild(seq[i]);
  }

  // Pure: move `key` by `delta` slots in an order array.
  function moveKey(order, key, delta) {
    var i = order.indexOf(key);
    if (i === -1) return order.slice();
    var j = Math.max(0, Math.min(order.length - 1, i + delta));
    if (j === i) return order.slice();
    var out = order.slice();
    out.splice(i, 1);
    out.splice(j, 0, key);
    return out;
  }

  /* ---- interactive wiring (browser only) ---- */

  function findCard(el) {
    return (el && el.closest) ? el.closest(".grid > .card") : null;
  }

  function cardKey(card) {
    return card ? card.getAttribute("data-widget") : null;
  }

  function cardLabel(card) {
    var h = card && card.querySelector(".card-head h2");
    return h ? h.textContent.trim().replace(/\s+/g, " ") : (cardKey(card) || "widget");
  }

  function makeLiveRegion() {
    var d = document.createElement("div");
    d.id = "drag-live";
    d.className = "sr-only";
    d.setAttribute("aria-live", "polite");
    document.body.appendChild(d);
    return d;
  }

  function init() {
    var grid = document.querySelector("main.grid");
    if (!grid) return;
    var live = makeLiveRegion();
    var announced = "";
    function announce(msg) {
      if (msg === announced) { live.textContent = ""; }
      announced = msg;
      // Re-setting after a tick makes repeat announcements speak reliably.
      setTimeout(function () { live.textContent = msg; }, 30);
    }

    var defaultOrder = keysOf(grid);
    var saved = loadOrder();
    applyOrder(grid, sanitizeOrder(saved, defaultOrder));

    function currentOrder() { return keysOf(grid); }
    function persist() { saveOrder(currentOrder()); }

    function positionText(card) {
      var order = currentOrder();
      var i = order.indexOf(cardKey(card));
      return cardLabel(card) + " moved to position " + (i + 1) + " of " + order.length;
    }

    // --- grip handles -------------------------------------------------
    var cards = Array.prototype.slice.call(grid.children);
    cards.forEach(function (card) {
      if (!cardKey(card)) return;
      var head = card.querySelector(".card-head");
      var handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = HANDLE_TEXT;
      handle.setAttribute("tabindex", "0");
      handle.setAttribute("role", "button");
      handle.setAttribute("aria-label",
        "Drag to reorder " + cardLabel(card) + ". Arrow keys move it; Home and End jump to the ends.");
      // Never let the handle trigger the card head's own behavior
      // (e.g. the bookmarks fold toggle, which listens for click and
      // Enter/Space on the fold head). Bubble phase, registered AFTER the
      // handlers below: at-target listeners run in registration order, so
      // the keyboard/drag handlers process the event first and only then
      // is it kept from bubbling out to the card head.
      function guardHead(e) { e.stopPropagation(); }
      if (head) head.insertBefore(handle, head.firstChild);
      else card.insertBefore(handle, card.firstChild);

      // Keyboard reorder.
      handle.addEventListener("keydown", function (e) {
        var delta = 0, edge = null;
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") delta = -1;
        else if (e.key === "ArrowDown" || e.key === "ArrowRight") delta = 1;
        else if (e.key === "Home") edge = 0;
        else if (e.key === "End") edge = -1;
        else return;
        e.preventDefault();
        var order = currentOrder();
        var i = order.indexOf(cardKey(card));
        var target = edge === null ? i + delta : (edge === 0 ? 0 : order.length - 1);
        target = Math.max(0, Math.min(order.length - 1, target));
        if (target === i) { announce(cardLabel(card) + " is already at the " + (target === 0 ? "top" : "bottom")); return; }
        var next = moveKey(order, cardKey(card), target - i);
        applyOrder(grid, next);
        persist();
        announce(positionText(card));
        // Moving the card drops focus to <body> in Chromium; hand it back
        // so the user can keep arrowing without re-tabbing.
        try { handle.focus({ preventScroll: true }); } catch (e) { try { handle.focus(); } catch (e2) {} }
      });

      wireHtml5DnD(card, handle);
      wireTouchDrag(card, handle);
      ["click", "pointerdown", "keydown"].forEach(function (t) {
        handle.addEventListener(t, guardHead);
      });
    });

    function clearIndicators() {
      var marked = grid.querySelectorAll(".drop-before, .drop-after");
      for (var i = 0; i < marked.length; i++) {
        marked[i].classList.remove("drop-before");
        marked[i].classList.remove("drop-after");
      }
    }

    // Where would `dragEl` land relative to the card under the pointer?
    function indicate(dragEl, clientX, clientY) {
      clearIndicators();
      var el = document.elementFromPoint(clientX, clientY);
      var target = findCard(el);
      if (!target || target === dragEl) return null;
      var r = target.getBoundingClientRect();
      // Grid flows in rows; the vertical midpoint decides before/after.
      var before = clientY < r.top + r.height / 2;
      target.classList.add(before ? "drop-before" : "drop-after");
      return { target: target, before: before };
    }

    function commit(dragEl, spot) {
      if (spot && spot.target !== dragEl) {
        grid.insertBefore(dragEl, spot.before ? spot.target : spot.target.nextSibling);
        persist();
        announce(positionText(dragEl));
      }
      clearIndicators();
    }

    // --- HTML5 drag-and-drop (desktop) --------------------------------
    var armed = null; // card whose handle saw pointerdown (mouse)
    function wireHtml5DnD(card, handle) {
      handle.addEventListener("pointerdown", function (e) {
        if (e.pointerType === "touch") return;
        card.draggable = true;
        armed = card;
      });
      window.addEventListener("pointerup", function () {
        if (armed === card) { card.draggable = false; armed = null; }
      }, true);
      card.addEventListener("dragstart", function (e) {
        if (armed !== card) { e.preventDefault(); return; } // never drag from the body
        card.classList.add("dragging");
        try {
          e.dataTransfer.setData("text/plain", cardKey(card) || "");
          e.dataTransfer.effectAllowed = "move";
        } catch (err) {}
      });
      card.addEventListener("dragend", function () {
        card.classList.remove("dragging");
        card.draggable = false;
        armed = null;
        clearIndicators();
      });
    }
    grid.addEventListener("dragover", function (e) {
      if (!grid.querySelector(".dragging")) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = "move"; } catch (err) {}
      indicate(grid.querySelector(".dragging"), e.clientX, e.clientY);
    });
    grid.addEventListener("drop", function (e) {
      var dragEl = grid.querySelector(".dragging");
      if (!dragEl) return;
      e.preventDefault();
      commit(dragEl, indicate(dragEl, e.clientX, e.clientY));
    });
    grid.addEventListener("dragleave", function (e) {
      if (e.relatedTarget && grid.contains(e.relatedTarget)) return;
      clearIndicators();
    });

    // --- Pointer Events fallback (touch) -------------------------------
    function wireTouchDrag(card, handle) {
      var pid = null, sx = 0, sy = 0, active = false, spot = null;
      handle.addEventListener("pointerdown", function (e) {
        if (e.pointerType !== "touch") return;
        pid = e.pointerId; sx = e.clientX; sy = e.clientY;
        active = false; spot = null;
        try { handle.setPointerCapture(pid); } catch (err) {}
      });
      handle.addEventListener("pointermove", function (e) {
        if (e.pointerId !== pid) return;
        var dx = e.clientX - sx, dy = e.clientY - sy;
        if (!active) {
          if (Math.hypot(dx, dy) < 10) return;
          active = true;
          card.classList.add("dragging");
          card.style.pointerEvents = "none"; // let elementFromPoint see cards below
        }
        e.preventDefault();
        card.style.transform = "translate(" + dx + "px," + dy + "px)";
        card.style.zIndex = "50";
        spot = indicate(card, e.clientX, e.clientY);
      });
      function end(e) {
        if (e.pointerId !== pid) return;
        if (active) {
          card.style.transform = "";
          card.style.zIndex = "";
          card.style.pointerEvents = "";
          card.classList.remove("dragging");
          commit(card, spot);
        }
        pid = null; active = false; spot = null;
      }
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    }

    // --- reset layout ---------------------------------------------------
    var resetBtn = document.getElementById("reset-layout");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        clearOrder();
        applyOrder(grid, defaultOrder);
        announce("Widget layout reset to the default order.");
      });
    }
  }

  var api = {
    ORDER_KEY: ORDER_KEY,
    keysOf: keysOf,
    sanitizeOrder: sanitizeOrder,
    loadOrder: loadOrder,
    saveOrder: saveOrder,
    clearOrder: clearOrder,
    applyOrder: applyOrder,
    moveKey: moveKey,
    init: init
  };

  if (typeof window !== "undefined") window.WidgetOrder = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // Run synchronously: this script sits after <main>, so the grid is parsed
  // and the saved order lands before first paint.
  if (typeof document !== "undefined" && typeof window !== "undefined") init();
})();
