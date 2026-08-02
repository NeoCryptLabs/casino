export const dynamic = "force-dynamic";

export default function Etat() {
  return (
    <main style={{ maxWidth: 620, margin: "8vh auto", padding: "0 24px" }}>
      <h1 style={{ fontWeight: 700, letterSpacing: 2 }}>LE MIRAGE</h1>
      <p>Serveur de jeu en ligne.</p>
      <ul>
        <li><a style={{ color: "#e8c477" }} href="/index.html">Entrer dans le casino</a></li>
        <li>WebSocket temps réel sur <code>/ws</code></li>
        <li>Aucune persistance : l’état des joueurs vit en mémoire.</li>
      </ul>
    </main>
  );
}
