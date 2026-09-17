import Link from "next/link";

export default function NotFound() {
  return <div className="page"><div className="page-head"><div><h1>No encontrado</h1><p>Ese cliente o esa llamada no existe.</p></div></div><Link href="/">← Volver al resumen</Link></div>;
}
