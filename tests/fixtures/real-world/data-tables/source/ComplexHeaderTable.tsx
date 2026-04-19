/**
 * ComplexHeaderTable — a multi-level header table using
 * <th scope="colgroup"> spanning headers and individual <td> cells
 * with explicit `headers` attribute references.
 *
 * semantics/table-headers must NOT fire — both <th> and <td> cells
 * are present; the table is properly structured even though it uses
 * colgroup-scoped spans rather than simple col scopes.
 *
 * This structure is common in financial/reporting UIs where a top-level
 * header groups two subordinate column headers.
 */

export function ComplexHeaderTable() {
  return (
    <table>
      <thead>
        <tr>
          <th id="hdr-product" rowSpan={2} scope="col">
            Product
          </th>
          <th id="hdr-sales" colSpan={2} scope="colgroup">
            Sales
          </th>
          <th id="hdr-returns" colSpan={2} scope="colgroup">
            Returns
          </th>
        </tr>
        <tr>
          <th id="hdr-sales-units" scope="col" headers="hdr-sales">
            Units
          </th>
          <th id="hdr-sales-value" scope="col" headers="hdr-sales">
            Value
          </th>
          <th id="hdr-returns-units" scope="col" headers="hdr-returns">
            Units
          </th>
          <th id="hdr-returns-value" scope="col" headers="hdr-returns">
            Value
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td headers="hdr-product">Widget Alpha</td>
          <td headers="hdr-sales hdr-sales-units">340</td>
          <td headers="hdr-sales hdr-sales-value">$17,000</td>
          <td headers="hdr-returns hdr-returns-units">12</td>
          <td headers="hdr-returns hdr-returns-value">$600</td>
        </tr>
        <tr>
          <td headers="hdr-product">Widget Beta</td>
          <td headers="hdr-sales hdr-sales-units">210</td>
          <td headers="hdr-sales hdr-sales-value">$10,500</td>
          <td headers="hdr-returns hdr-returns-units">5</td>
          <td headers="hdr-returns hdr-returns-value">$250</td>
        </tr>
      </tbody>
    </table>
  );
}
