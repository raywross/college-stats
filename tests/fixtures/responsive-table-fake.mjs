// A stand-in for components/admin/ResponsiveTable.tsx in the page and component render tests: it renders every row's
// every column (the cell) as plain markup, so a test sees what a row holds without the real table's breakpoints. The
// real component is covered by tests/admin-phone.test.mts.
import React from "react";

export function ResponsiveTable({ rows, columns, rowKey, empty, caption }) {
  if (rows.length === 0) return typeof empty === "string" ? React.createElement("p", null, empty) : empty;
  return React.createElement(
    "ul",
    { "data-responsive-table": caption ?? "" },
    React.createElement("li", { key: "__header" }, columns.map((c) => React.createElement("span", { key: c.key, "data-header": c.key }, c.header))),
    rows.map((row) =>
      React.createElement(
        "li",
        { key: rowKey(row), "data-row": rowKey(row) },
        columns.map((c) => React.createElement("div", { key: c.key, "data-col": c.key }, c.cell(row))),
      ),
    ),
  );
}
