export const Bad = (): JSX.Element => (
  <article lang="en">
    <p>
      A POSIX-style locale leaked into JSX:
      <span lang="fr_FR">bonjour</span>.
    </p>
  </article>
);
