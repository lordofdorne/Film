import Link from "next/link";

import { authConfigured, currentUser } from "../src/server/auth.js";
import { listProjects } from "../src/server/project.js";
import { SignOutButton } from "./SignOutButton.js";

export default async function Home() {
  const open = !authConfigured();
  const user = await currentUser();

  // Nobody signed in, and sign-in exists: there is nothing of theirs to list.
  if (!open && user === null) {
    return (
      <main style={styles.page}>
        <h1 style={styles.title}>Life Advice</h1>
        <p style={styles.blurb}>
          A short documentary made from an interview with someone you love.
        </p>
        <div style={styles.actions}>
          <Link href="/start" style={styles.primary}>
            Make a film
          </Link>
          <Link href="/signin" style={styles.secondary}>
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const projects = await listProjects(user?.id);

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Your films</h1>
        {user !== null && (
          <span style={styles.who}>
            {user.email} · <SignOutButton />
          </span>
        )}
      </header>

      {open && (
        /**
         * Loud on purpose. "Auth quietly turned itself off" is the worst way
         * for this to be wrong, so an unconfigured server says so on the page
         * rather than in a log nobody reads.
         */
        <p style={styles.warning}>
          No sign-in is configured on this server, so every film here is open to
          anyone who can reach it. Development only.
        </p>
      )}

      {projects.length === 0 ? (
        <p style={styles.blurb}>
          Nothing here yet. <Link href="/start">Make a film</Link>.
        </p>
      ) : (
        <ul style={styles.list}>
          {projects.map((p) => (
            <li key={p.id} style={styles.row}>
              <Link href={`/projects/${p.id}`} style={styles.name}>
                {p.subjectName}
              </Link>
              <span style={styles.status}>{p.status}</span>
            </li>
          ))}
        </ul>
      )}

      <p style={styles.footer}>
        <Link href="/start" style={styles.secondary}>
          Start another
        </Link>
      </p>
    </main>
  );
}

const styles = {
  page: { maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, sans-serif", color: "#1a1a1a" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" as const },
  title: { fontSize: 24, fontWeight: 600, margin: 0 },
  who: { fontSize: 13, color: "#888" },
  blurb: { color: "#666", fontSize: 16, lineHeight: 1.6 },
  actions: { display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" as const },
  primary: { background: "#12603a", color: "#fff", borderRadius: 8, padding: "12px 22px", fontSize: 15, fontWeight: 600, textDecoration: "none" },
  secondary: { border: "1px solid #ccc", borderRadius: 8, padding: "11px 21px", fontSize: 15, textDecoration: "none", color: "#1a1a1a" },
  warning: { fontSize: 13, lineHeight: 1.5, color: "#5c4a33", background: "#fdf6ec", border: "1px solid #f0dcc0", borderRadius: 8, padding: "10px 12px", margin: "16px 0 0" },
  list: { listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8, margin: "24px 0 0" },
  row: { border: "1px solid #e4e4e4", borderRadius: 8, padding: 14 },
  name: { fontWeight: 600, textDecoration: "none", color: "#12603a" },
  status: { marginLeft: 10, color: "#888", fontSize: 13 },
  footer: { marginTop: 28 },
} as const;
