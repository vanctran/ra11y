import { Link } from "@example/router";

export function AboutRoute() {
  return (
    <div>
      <nav aria-label="Primary">
        <Link to="/about">About</Link>
        <Link to="/home">Home</Link>
        <Link to="/contact">Contact</Link>
      </nav>
      <section>
        <h2>About Us</h2>
        <p>This is the about page content area.</p>
      </section>
    </div>
  );
}
