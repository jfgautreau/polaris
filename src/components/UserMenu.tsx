"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Avatar rond (initiale) + menu : mes informations, mot de passe, deconnexion.
// `guideVisible` : le lien « Guide utilisateur » est affiché sauf si le
// super_admin l'a masqué pour ce site (cf. /platform, site_module clé `guide`).
export default function UserMenu({
  name,
  email,
  guideVisible = true,
}: {
  name: string;
  email: string;
  guideVisible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const display = (name && name.trim()) || email || "?";
  const initial = display.trim().charAt(0).toUpperCase();

  const item: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 12px",
    borderRadius: 7,
    textDecoration: "none",
    color: "var(--text)",
    fontSize: 14,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    margin: 0,
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={display}
        aria-label={`Compte de ${display}`}
        style={{
          margin: 0,
          width: 34,
          height: 34,
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          fontWeight: 700,
          lineHeight: 1,
          color: "#fff",
          background: open ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.18)",
          border: "1px solid rgba(255,255,255,0.45)",
          borderRadius: "50%",
          cursor: "pointer",
        }}
      >
        {initial}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 10px 28px rgba(0,0,0,0.2)",
            minWidth: 230,
            zIndex: 60,
            padding: 6,
          }}
        >
          <div style={{ padding: "8px 12px 10px", borderBottom: "1px solid var(--border)", marginBottom: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{display}</div>
            {email && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{email}</div>}
          </div>

          <Link href="/compte" onClick={() => setOpen(false)} style={item}>
            🔑&nbsp; Changer le mot de passe
          </Link>

          {/* Guide utilisateur : document autonome (public/guide.html), ouvert dans
              un onglet a part pour ne pas faire perdre une saisie en cours.
              Masquable par site depuis /platform (prop guideVisible). */}
          {guideVisible && (
            <a
              href="/guide.html"
              target="_blank"
              rel="noopener"
              onClick={() => setOpen(false)}
              style={item}
              title="Ouvrir le guide utilisateur dans un nouvel onglet"
            >
              📘&nbsp; Guide utilisateur
            </a>
          )}

          <div style={{ borderTop: "1px solid var(--border)", margin: "6px 0" }} />

          <form action="/logout" method="post">
            <button type="submit" style={{ ...item, color: "var(--danger)", fontWeight: 600 }}>
              ⏻&nbsp; Se déconnecter
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
