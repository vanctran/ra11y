/**
 * Sanitized fixture: navigation bar with a logo using className="logo"
 * (without the "site-" prefix) to verify the keyword match works on the
 * bare "logo" class name, not only "site-logo".
 */

export function NavBar() {
  return (
    <nav className="navbar" aria-label="Site navigation">
      <a href="/" className="navbar-brand">
        <img src="/logo.svg" alt="Contoso" className="logo" />
      </a>
      <ul>
        <li><a href="/products">Products</a></li>
        <li><a href="/pricing">Pricing</a></li>
        <li><a href="/contact">Contact</a></li>
      </ul>
    </nav>
  );
}

export default NavBar;
