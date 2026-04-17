import { Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage.tsx";
import { ProductList } from "./pages/ProductList.tsx";
import { ContactPage } from "./pages/ContactPage.tsx";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/products" element={<ProductList />} />
      <Route path="/contact" element={<ContactPage />} />
    </Routes>
  );
}
