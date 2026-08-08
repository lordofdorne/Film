import Link from "next/link";
import { listProjects } from "../src/server/project.js";

export default async function Home() {
  const projects = await listProjects();

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>Projects</h1>
      {projects.length === 0 ? (
        <p style={{ color: "#666" }}>
          No projects yet. Seed one from the local render with <code>pnpm seed:real</code>.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {projects.map((p) => (
            <li key={p.id} style={{ border: "1px solid #e4e4e4", borderRadius: 8, padding: 14 }}>
              <Link href={`/projects/${p.id}`} style={{ fontWeight: 600, textDecoration: "none", color: "#12603a" }}>
                {p.subjectName}
              </Link>
              <span style={{ marginLeft: 10, color: "#888", fontSize: 13 }}>{p.status}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
