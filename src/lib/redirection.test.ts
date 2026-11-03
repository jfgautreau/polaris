import { describe, it, expect } from "vitest";
import { cheminInterne } from "./redirection";

describe("cheminInterne (retour après connexion)", () => {
  it("accepte un chemin interne, requête comprise", () => {
    expect(cheminInterne("/affichage/atelier/abc")).toBe("/affichage/atelier/abc");
    expect(cheminInterne("/affichage/impression?atelier=a&atelier=b")).toBe("/affichage/impression?atelier=a&atelier=b");
  });
  it("refuse une autre origine", () => {
    expect(cheminInterne("//exemple.com")).toBeNull();
    expect(cheminInterne("/\\exemple.com")).toBeNull();
    expect(cheminInterne("https://exemple.com")).toBeNull();
    expect(cheminInterne("exemple.com")).toBeNull();
  });
  it("refuse les caractères de contrôle, le vide et l'écran de connexion", () => {
    expect(cheminInterne("/\t/exemple.com")).toBeNull();
    expect(cheminInterne("")).toBeNull();
    expect(cheminInterne(null)).toBeNull();
    expect(cheminInterne("/login")).toBeNull();
    expect(cheminInterne("/login?next=/x")).toBeNull();
  });
});
