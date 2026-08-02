import { redirect } from "next/navigation";

// La racine appartient au jeu : le serveur personnalisé sert index.html avant
// d'atteindre Next. Cette page n'existe que comme filet de sécurité.
export default function Home() {
  redirect("/index.html");
}
