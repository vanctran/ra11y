import { Link } from "@example/router";

export function HomeRoute() {
  return (
    <div>
      <nav aria-label="Primary">
        <Link to="/home">Home</Link>
        <Link to="/about">About</Link>
        <Link to="/contact">Contact</Link>
      </nav>
      <section>
        <h2>Welcome</h2>
        <p>This is the home page content area.</p>
      </section>
    </div>
  );
}
