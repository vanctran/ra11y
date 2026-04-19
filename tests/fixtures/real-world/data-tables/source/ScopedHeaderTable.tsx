/**
 * ScopedHeaderTable — a well-formed data table with <th scope="col">
 * header cells in <thead> and <th scope="row"> row headers.
 *
 * semantics/table-headers must NOT fire here — the table has explicit
 * <th> cells that give screen readers full column and row context.
 */

interface Entry {
  region: string;
  q1: number;
  q2: number;
  q3: number;
}

const DATA: Entry[] = [
  { region: "North", q1: 120, q2: 145, q3: 98 },
  { region: "South", q1: 87, q2: 91, q3: 110 },
  { region: "East", q1: 200, q2: 178, q3: 215 },
];

export function ScopedHeaderTable() {
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Region</th>
          <th scope="col">Q1</th>
          <th scope="col">Q2</th>
          <th scope="col">Q3</th>
        </tr>
      </thead>
      <tbody>
        {DATA.map((entry) => (
          <tr key={entry.region}>
            <th scope="row">{entry.region}</th>
            <td>{entry.q1}</td>
            <td>{entry.q2}</td>
            <td>{entry.q3}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
