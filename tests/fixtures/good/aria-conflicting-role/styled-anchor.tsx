// <a role="button"> with no href and no handler is a styled-div
// pattern the author is using intentionally — the role clarifies
// author intent. The rule stays quiet; the agent reading the file
// can decide whether the pattern is correct.
export function StyledAnchor(): JSX.Element {
  return (
    <a role="button" className="styled-like-a-button">
      Action
    </a>
  );
}
