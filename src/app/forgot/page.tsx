"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    // Base publique stable : NEXT_PUBLIC_SITE_URL (prod) plutôt que l'origine
    // du navigateur, pour qu'un lien lancé depuis un autre domaine (preview,
    // localhost) ne parte pas faux. Repli sur l'origine si la variable n'est
    // pas posée. ⚠️ Cette URL doit aussi figurer dans les « Redirect URLs » du
    // projet Supabase, sinon GoTrue la remplace par la Site URL (cf. OPERATIONS).
    const base = (process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || window.location.origin);
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${base}/auth/callback?next=/reset`,
    });
    setPending(false);
    // Toujours afficher un succes (ne pas reveler l'existence du compte).
    setSent(true);
  }

  return (
    <div className="container">
      <div className="card card-narrow">
        <h1>Mot de passe oublié</h1>
        {sent ? (
          <p className="success">
            Si un compte existe pour cet email, un lien de réinitialisation a été
            envoyé.
          </p>
        ) : (
          <form onSubmit={onSubmit}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" disabled={pending}>
              {pending ? "Envoi..." : "Envoyer le lien"}
            </button>
          </form>
        )}
        <p className="muted" style={{ marginTop: 16 }}>
          <Link href="/login">Retour à la connexion</Link>
        </p>
      </div>
    </div>
  );
}
