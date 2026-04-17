/**
 * Sanitized fixture: generic site homepage with logo and product images.
 *
 * The two <img> elements demonstrate the asymmetric logotype-annotation
 * behaviour introduced in commit 71b9954:
 *
 *   site-logo.svg  — className="site-logo"  triggers logoLike() -> true
 *   product.png    — className="product-img" does NOT trigger logoLike()
 *
 * A second variant with className="logo" (vs "site-logo") is in NavBar.tsx
 * to verify both keyword-containing class names are detected.
 */

interface HomePageProps {
  readonly productImageSrc: string;
  readonly productAlt: string;
}

export function HomePage({ productImageSrc, productAlt }: HomePageProps) {
  return (
    <main>
      <header className="page-header">
        <img src="/assets/brand-logo.svg" alt="Contoso" className="site-logo" />
        <nav aria-label="Primary navigation">
          <a href="/">Home</a>
          <a href="/products">Products</a>
          <a href="/about">About</a>
        </nav>
      </header>

      <section className="hero">
        <h1>Welcome to Contoso</h1>
        <p>
          Explore our product line below.
        </p>
        <img
          src={productImageSrc}
          alt={productAlt}
          className="product-img"
        />
      </section>
    </main>
  );
}

export default HomePage;
