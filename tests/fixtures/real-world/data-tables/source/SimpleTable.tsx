/**
 * SimpleTable — renders a data table with no <th> header cells.
 *
 * Every cell is a <td>, so screen readers announce values with no
 * column or row context. This is the failing case that
 * semantics/table-headers must flag.
 */

interface Row {
  label: string;
  quantity: number;
  unit: string;
}

const ROWS: Row[] = [
  { label: "Widget Alpha", quantity: 12, unit: "pcs" },
  { label: "Widget Beta", quantity: 4, unit: "boxes" },
  { label: "Widget Gamma", quantity: 99, unit: "pcs" },
];

export function SimpleTable() {
  return (
    <table>
      <tbody>
        <tr>
          <td>Item</td>
          <td>Qty</td>
          <td>Unit</td>
        </tr>
        {ROWS.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td>{row.quantity}</td>
            <td>{row.unit}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
