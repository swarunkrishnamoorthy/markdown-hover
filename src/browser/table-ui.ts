// Wide, resizable tables.
//
// The reading column is narrow (820px), which squeezes a six-column table into
// tall, unreadable cells. Each table is wrapped so it can break out to the
// window width, and gets drag handles: the right edge of a header cell resizes
// that column, the bottom edge of a row's first cell resizes that row. "Reset"
// returns the table to automatic sizing.

const MIN_COL = 48;
const MIN_ROW = 24;

function firstRow(table: HTMLTableElement): HTMLTableRowElement | null {
  return table.rows.length ? table.rows[0] : null;
}

/** Fix every column to its current pixel width so one can be changed alone. */
function freezeColumns(table: HTMLTableElement): HTMLTableColElement[] {
  const head = firstRow(table);
  if (!head) {
    return [];
  }
  const existing = table.querySelector("colgroup.mhg-cols");
  if (existing) {
    return Array.from(existing.querySelectorAll("col"));
  }
  const widths = Array.from(head.cells).map((c) => c.getBoundingClientRect().width);
  const colgroup = document.createElement("colgroup");
  colgroup.className = "mhg-cols";
  const cols = widths.map((w) => {
    const col = document.createElement("col");
    col.style.width = `${Math.round(w)}px`;
    colgroup.appendChild(col);
    return col;
  });
  table.prepend(colgroup);
  table.style.tableLayout = "fixed";
  table.style.width = `${Math.round(widths.reduce((a, b) => a + b, 0))}px`;
  table.style.maxWidth = "none";
  return cols;
}

function syncTableWidth(table: HTMLTableElement, cols: HTMLTableColElement[]) {
  const total = cols.reduce((sum, c) => sum + (parseFloat(c.style.width) || 0), 0);
  table.style.width = `${Math.round(total)}px`;
}

function drag(
  el: HTMLElement,
  e: PointerEvent,
  onMove: (dx: number, dy: number) => void,
  cursor: string
) {
  e.preventDefault();
  e.stopPropagation();
  const x0 = e.clientX;
  const y0 = e.clientY;
  el.setPointerCapture(e.pointerId);
  el.classList.add("mhg-grip-active");
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
  const move = (ev: PointerEvent) => onMove(ev.clientX - x0, ev.clientY - y0);
  const up = () => {
    el.releasePointerCapture(e.pointerId);
    el.classList.remove("mhg-grip-active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

function addColumnGrip(
  table: HTMLTableElement,
  cell: HTMLTableCellElement,
  index: number,
  onChange: () => void
) {
  const grip = document.createElement("span");
  grip.className = "mhg-grip mhg-col-grip";
  grip.title = "Drag to resize column (double-click to reset the table)";
  grip.addEventListener("pointerdown", (e) => {
    const cols = freezeColumns(table);
    const col = cols[index];
    if (!col) {
      return;
    }
    const start = parseFloat(col.style.width) || cell.getBoundingClientRect().width;
    const total0 = cols.reduce((sum, c) => sum + (parseFloat(c.style.width) || 0), 0);
    const room = (table.parentElement as HTMLElement).clientWidth;
    // A table narrower than its wrapper is centered, so widening a column by d
    // moves that column's right edge by only d/2 (the left edge moves back d/2).
    // Solve for the d that keeps the edge under the cursor.
    const left = (total: number) => Math.max(0, (room - total) / 2);
    drag(
      grip,
      e,
      (dx) => {
        let delta = dx;
        for (let i = 0; i < 8; i++) {
          const edgeShift = delta + left(total0 + delta) - left(total0);
          delta += dx - edgeShift;
        }
        col.style.width = `${Math.max(MIN_COL, Math.round(start + delta))}px`;
        syncTableWidth(table, cols);
        onChange();
      },
      "col-resize"
    );
  });
  cell.appendChild(grip);
}

function addRowGrip(row: HTMLTableRowElement, onChange: () => void) {
  const cell = row.cells[0];
  if (!cell) {
    return;
  }
  const grip = document.createElement("span");
  grip.className = "mhg-grip mhg-row-grip";
  grip.title = "Drag to resize row";
  grip.addEventListener("pointerdown", (e) => {
    const start = row.getBoundingClientRect().height;
    drag(
      grip,
      e,
      (_dx, dy) => {
        const h = `${Math.max(MIN_ROW, Math.round(start + dy))}px`;
        for (const c of Array.from(row.cells)) {
          c.style.height = h;
        }
        onChange();
      },
      "row-resize"
    );
  });
  cell.appendChild(grip);
}

function reset(table: HTMLTableElement) {
  table.querySelector("colgroup.mhg-cols")?.remove();
  table.style.tableLayout = "";
  table.style.width = "";
  table.style.maxWidth = "";
  for (const c of Array.from(table.querySelectorAll<HTMLElement>("th, td"))) {
    c.style.height = "";
  }
}

function enhance(table: HTMLTableElement) {
  const wrap = document.createElement("div");
  wrap.className = "mhg-table-wrap";
  table.replaceWith(wrap);
  wrap.appendChild(table);

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "mhg-table-reset";
  resetBtn.textContent = "Reset sizes";
  resetBtn.title = "Back to automatic column and row sizes";
  resetBtn.hidden = true;
  resetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    reset(table);
    resetBtn.hidden = true;
  });
  const onChange = () => {
    resetBtn.hidden = false;
  };

  const head = firstRow(table);
  if (head) {
    Array.from(head.cells).forEach((cell, i) => addColumnGrip(table, cell, i, onChange));
  }
  for (const row of Array.from(table.rows)) {
    addRowGrip(row, onChange);
  }
  wrap.addEventListener("dblclick", (e) => {
    if ((e.target as Element).closest(".mhg-grip")) {
      reset(table);
      resetBtn.hidden = true;
    }
  });
  wrap.prepend(resetBtn);
}

/** Make every table under `root` wide and resizable. Safe to call on every load. */
export function mountTables(root: ParentNode): number {
  let count = 0;
  for (const table of Array.from(root.querySelectorAll("table"))) {
    if (table.closest(".mhg-table-wrap, .mhg-card, .mhg-mermaid")) {
      continue;
    }
    enhance(table);
    count++;
  }
  return count;
}
