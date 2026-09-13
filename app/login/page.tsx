import Link from "next/link";
import { Sparkles } from "lucide-react";
import { signIn, signUp } from "./actions";

export const metadata = { title: "Entrar · Pulso AI" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const pick = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);
  const signup = pick("mode") === "signup";
  const error = pick("error");
  const message = pick("message");

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand"><span className="brand-mark"><Sparkles size={17} /></span><b>PULSO</b><span className="ai-pill">AI</span></div>
        <h1>{signup ? "Crea tu cuenta" : "Bienvenido de vuelta"}</h1>
        <p>{signup ? "Conecta tus cuentas de Meta y deja que los agentes cuiden tu presupuesto." : "Entra para revisar lo que hicieron tus agentes."}</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {message && <div className="auth-message" role="status">{message}</div>}
        <form className="auth-form" action={signup ? signUp : signIn}>
          <input type="hidden" name="next" value={pick("next") ?? "/"} />
          {signup && <label><span>Nombre</span><input name="name" autoComplete="name" maxLength={80} required /></label>}
          <label><span>Correo</span><input name="email" type="email" autoComplete="email" required /></label>
          <label><span>Contraseña</span><input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={8} required /></label>
          <button className="primary-button" type="submit">{signup ? "Crear cuenta" : "Entrar"}</button>
        </form>
        <div className="auth-switch">
          {signup
            ? <>¿Ya tienes cuenta? <Link href="/login">Inicia sesión</Link></>
            : <>¿Nuevo en Pulso? <Link href="/login?mode=signup">Crea una cuenta</Link></>}
        </div>
      </section>
    </main>
  );
}
