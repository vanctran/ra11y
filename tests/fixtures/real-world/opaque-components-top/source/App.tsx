/**
 * Consumer file. Each component is used a distinct number of times so
 * the ranking is unambiguous:
 *
 *   Button  x12  — rank 1 (must be in top 5)
 *   Card    x8   — rank 2 (must be in top 5)
 *   Modal   x6   — rank 3 (must be in top 5)
 *   Tooltip x5   — rank 4 (must be in top 5)
 *   Avatar  x3   — rank 5 (must be in top 5)
 *   Badge   x2   — rank 6 (must NOT be in top 5 under default cap)
 *   Banner  x1   — rank 7 (must NOT be in top 5)
 *   Popover x1   — rank 8 (tie with Banner, broken alphabetically)
 *   Sheet   x1   — rank 9
 *   Toast   x1   — rank 10
 *   Dialog  x1   — rank 11
 *
 * All call sites use onClick so the interactive filter keeps every
 * component in the ranking (non-interactive components are filtered out
 * of opaqueCustomComponentsTop even when they have high call counts).
 */

export default function App() {
  const noop = () => {};
  return (
    <div>
      <Button onClick={noop} />
      <Button onClick={noop} />
      <Button onClick={noop} />
      <Button onClick={noop} />
      <Button onClick={noop} />
      <Button onClick={noop} />
      <Button onClick={noop} />
      <Button onClick={noop} />
      <Button onClick={noop} />
      <Button onClick={noop} />
      <Button onClick={noop} />
      <Button onClick={noop} />
      <Card onClick={noop} />
      <Card onClick={noop} />
      <Card onClick={noop} />
      <Card onClick={noop} />
      <Card onClick={noop} />
      <Card onClick={noop} />
      <Card onClick={noop} />
      <Card onClick={noop} />
      <Modal onClick={noop} />
      <Modal onClick={noop} />
      <Modal onClick={noop} />
      <Modal onClick={noop} />
      <Modal onClick={noop} />
      <Modal onClick={noop} />
      <Tooltip onClick={noop} />
      <Tooltip onClick={noop} />
      <Tooltip onClick={noop} />
      <Tooltip onClick={noop} />
      <Tooltip onClick={noop} />
      <Avatar onClick={noop} />
      <Avatar onClick={noop} />
      <Avatar onClick={noop} />
      <Badge onClick={noop} />
      <Badge onClick={noop} />
      <Banner onClick={noop} />
      <Popover onClick={noop} />
      <Sheet onClick={noop} />
      <Toast onClick={noop} />
      <Dialog onClick={noop} />
    </div>
  );
}
