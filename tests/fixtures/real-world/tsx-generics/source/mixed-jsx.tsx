/**
 * The mixed case: a single module that contains both TypeScript
 * generics AND actual JSX. Before 2968d87 the generic parse error
 * cascaded — once the tokenizer entered unclosed-JSX recovery it
 * misparsed the real JSX below as children, and rules never saw
 * the tree.
 *
 * The assertion on this fixture is just "no parse errors"; if that
 * is green, rules saw the div/span and could have evaluated them.
 */
import type { HTMLAttributes } from "react";

type WidgetViewProps = Pick<HTMLAttributes<HTMLDivElement>, "id" | "className">;

export function WidgetView(props: WidgetViewProps): JSX.Element {
  return (
    <div id={props.id} className={props.className}>
      <span>placeholder content</span>
    </div>
  );
}
